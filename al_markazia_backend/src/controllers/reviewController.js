const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { sanitizeComment, isContentSafe } = require('../services/contentFilter');
const { SOCKET_EVENTS, SOCKET_ROOMS } = require('../shared/socketEvents');
const { mapOrderResponse } = require('../mappers/order.mapper');
const { ORDER_INCLUDE_FULL } = require('../shared/prismaConstants');

/**
 * 🔒 Submit a new review (Customer Only + Verified Purchase)
 */
exports.submitReview = async (req, res) => {
  try {
    const { itemId, rating, comment } = req.body;
    
    // ✅ Role check: Only customers can review
    if (req.user.role !== 'customer') {
      return res.status(403).json({ success: false, error: 'فقط الزبائن يقدرون يضيفوا تقييم' });
    }

    const userUuid = req.user.id;

    // 1. Resolve Customer
    const customer = await prisma.customer.findUnique({
      where: { uuid: userUuid },
      select: { id: true, isBlacklisted: true, name: true }
    });

    if (!customer) return res.status(404).json({ error: 'حساب الزبون غير موجود' });
    if (customer.isBlacklisted) return res.status(403).json({ error: 'حسابك معلق من إضافة التقييمات' });

    // 2. Validation
    const itemIdInt = parseInt(itemId);
    const ratingInt = parseInt(rating);
    if (isNaN(itemIdInt) || isNaN(ratingInt) || ratingInt < 1 || ratingInt > 5) {
      return res.status(400).json({ error: 'البيانات المرسلة غير صحيحة' });
    }

    // 3. Verified Purchase Check
    const purchasedOrder = await prisma.order.findFirst({
      where: {
        customerId: customer.id,
        status: 'delivered',
        orderItems: { some: { itemId: itemIdInt } }
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true }
    });

    if (!purchasedOrder) {
      return res.status(403).json({ 
        error: 'يجب أن تطلب الصنف أولاً قبل تقييمه',
        code: 'NOT_PURCHASED'
      });
    }

    // 4. Duplicate Check (Scoped per delivered order to allow re-reviewing separate future orders of the same item)
    const existing = await prisma.review.findFirst({
      where: { customerId: customer.id, orderId: purchasedOrder.id, itemId: itemIdInt }
    });

    if (existing) {
      return res.status(409).json({ 
        error: 'لقد قمت بتقييم هذا الصنف مسبقاً في هذا الطلب',
        code: 'ALREADY_REVIEWED'
      });
    }

    // 5. Content Sanitization
    const cleanComment = sanitizeComment(comment);
    if (cleanComment) {
      const safety = isContentSafe(cleanComment);
      if (!safety.safe) {
        return res.status(400).json({ error: 'التعليق يحتوي على محتوى غير مسموح' });
      }
    }

    // 6. Create Review
    const review = await prisma.review.create({
      data: {
        itemId: itemIdInt,
        customerId: customer.id,
        orderId: purchasedOrder.id,
        rating: ratingInt,
        comment: cleanComment,
        isVerifiedPurchase: true,
        status: 'PENDING', // 🛡️ [SEC-FIX] Set enum status to PENDING schema format
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')?.substring(0, 200)
      },
      include: { item: { select: { title: true } } }
    });

    const responseData = {
      ...review,
      isApproved: review.status === 'APPROVED'
    };

    const io = req.app.get('io');
    if (io) {
      io.to(SOCKET_ROOMS.ADMIN).emit(SOCKET_EVENTS.NEW_REVIEW, { review: responseData });
    }

    res.status(201).json({
      success: true,
      data: responseData
    });
  } catch (error) {
    logger.error('Submit review error', { error: error.message });
    res.status(500).json({ success: false, error: 'فشل إرسال التقييم' });
  }
};

/**
 * 📖 Public: Fetch approved reviews for an item (With Pagination)
 */
exports.getItemReviews = async (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId);
    if (isNaN(itemId)) return res.status(400).json({ success: false, error: 'Item ID is required' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { itemId, status: 'APPROVED' },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          rating: true,
          comment: true,
          status: true,
          isVerifiedPurchase: true,
          createdAt: true,
          customer: { select: { name: true } }
        }
      }),
      prisma.review.count({ where: { itemId, status: 'APPROVED' } })
    ]);

    const mappedReviews = reviews.map(r => ({
      ...r,
      isApproved: true
    }));

    res.json({
      success: true,
      data: mappedReviews,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    logger.error('Fetch item reviews error', { itemId: req.params.itemId, error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch reviews' });
  }
};

/**
 * 👮 Admin: Fetch all reviews (Consolidated + Correct Pagination)
 */
exports.getAllReviews = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;

    const reviewFilter = {};
    const orderFilter = { rating: { not: null } };

    if (req.user && (req.user.role === 'branch_manager' || req.user.role === 'manager')) {
      if (req.user.branchId) {
        reviewFilter.branchId = req.user.branchId;
        orderFilter.branchId = req.user.branchId;
      }
    }

    const [itemReviews, orderRatings] = await Promise.all([
      prisma.review.findMany({
        where: reviewFilter,
        include: {
          item: { select: { title: true, id: true, image: true } },
          customer: { select: { name: true, phone: true } }
        }
      }),
      prisma.order.findMany({
        where: orderFilter,
        include: ORDER_INCLUDE_FULL
      })
    ]);

    const mappedItemReviews = itemReviews.map(r => ({
      ...r,
      type: 'item_review',
      isApproved: r.status === 'APPROVED',
      customerName: r.customer?.name || 'مجهول',
      customerPhone: r.customer?.phone
    }));

    const mappedOrderRatings = orderRatings.map(o => ({
      id: `order-${o.id}`,
      realId: o.id,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      rating: o.rating,
      comment: o.ratingComment,
      isApproved: o.isRatingApproved,
      type: 'order_rating',
      createdAt: o.createdAt,
      orderNumber: o.orderNumber,
      fullOrder: mapOrderResponse(o) // 🧾 [FIX] Include full order for invoice viewing
    }));

    // 🧩 Merge and Sort by Date
    const all = [...mappedItemReviews, ...mappedOrderRatings].sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    const total = all.length;
    const paginated = all.slice(skip, skip + limit);

    res.json({ 
      success: true, 
      data: paginated,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    logger.error('Get all reviews error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * 👮 Admin: Toggle approval status
 */
exports.toggleApproval = async (req, res) => {
  try {
    const { id } = req.params;
    const { isApproved } = req.body;

    // Handle Order Rating Approval
    if (typeof id === 'string' && id.startsWith('order-')) {
      const realId = parseInt(id.replace('order-', ''));
      if (isNaN(realId)) return res.status(400).json({ error: 'Invalid Order ID' });
      
      await prisma.order.update({
        where: { id: realId },
        data: { isRatingApproved: Boolean(isApproved) }
      });
      return res.json({ success: true });
    }

    // Handle Item Review Approval
    const reviewId = parseInt(id);
    if (isNaN(reviewId)) return res.status(400).json({ error: 'Invalid Review ID' });

    const review = await prisma.review.update({
      where: { id: reviewId },
      data: { status: Boolean(isApproved) ? 'APPROVED' : 'REJECTED', isFlagged: false }
    });

    // 🚀 Update Item Cache (Background)
    await updateItemStats(review.itemId);

    // 🎁 [LOYALTY-FIX] Emit reward event on approval
    if (review.status === 'APPROVED') {
      try {
        const container = require('../lib/container');
        const points = await container.loyaltyService.calculateEngagementPoints('REVIEW');
        
        await prisma.systemOutbox.create({
          data: {
            type: 'loyalty.review_award',
            aggregateId: String(review.id),
            aggregateType: 'Review',
            payload: {
              reviewId: review.id,
              customerId: review.customerId,
              points
            }
          }
        });
        logger.info(`[ReviewController] Enqueued loyalty reward for review #${review.id}`);
      } catch (err) {
        logger.error('[ReviewController] Failed to enqueue loyalty reward', { error: err.message });
      }
    }

    res.json({
      ...review,
      isApproved: review.status === 'APPROVED'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status' });
  }
};

/**
 * 🚩 Flag/Report a review
 */
exports.flagReview = async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id);
    if (isNaN(reviewId)) return res.status(400).json({ error: 'Invalid ID' });

    await prisma.review.update({
      where: { id: reviewId },
      data: { isFlagged: true }
    });
    res.json({ success: true, message: 'Review flagged' });
  } catch (error) {
    res.status(500).json({ error: 'Action failed' });
  }
};

/**
 * 📝 Customer: Update an existing review
 */
exports.updateReview = async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id);
    const { rating, comment } = req.body;

    if (isNaN(reviewId)) return res.status(400).json({ error: 'Invalid ID' });

    // 1. Fetch Review to check ownership
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      include: { customer: { select: { uuid: true } } }
    });

    if (!review) return res.status(404).json({ error: 'التقييم غير موجود' });
    
    // 🛡️ Ownership check
    if (review.customer.uuid !== req.user.id) {
      return res.status(403).json({ error: 'لا يمكنك تعديل تقييم لا تملكه' });
    }

    // 2. Validation
    const ratingInt = parseInt(rating);
    if (rating && (isNaN(ratingInt) || ratingInt < 1 || ratingInt > 5)) {
      return res.status(400).json({ error: 'التقييم يجب أن يكون بين 1 و 5' });
    }

    // 3. Content Sanitization
    const cleanComment = comment !== undefined ? sanitizeComment(comment) : review.comment;
    if (cleanComment && cleanComment !== review.comment) {
      const safety = isContentSafe(cleanComment);
      if (!safety.safe) {
        return res.status(400).json({ error: 'التعليق يحتوي على محتوى غير مسموح' });
      }
    }

    // 4. Update
    const updated = await prisma.review.update({
      where: { id: reviewId },
      data: {
        rating: ratingInt || review.rating,
        comment: cleanComment,
        status: 'PENDING', // 🛡️ Re-review required after update
        updatedAt: new Date()
      }
    });

    // 🚀 Update Item Cache (Background)
    await updateItemStats(updated.itemId);

    res.json({ 
      success: true, 
      data: {
        ...updated,
        isApproved: updated.status === 'APPROVED'
      } 
    });
  } catch (error) {
    logger.error('Update review error', { error: error.message });
    res.status(500).json({ success: false, error: 'فشل تحديث التقييم' });
  }
};

/**
 * 👮 Admin: Delete a review
 */
exports.deleteReview = async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id);
    if (isNaN(reviewId)) return res.status(400).json({ error: 'Invalid ID' });

    const review = await prisma.review.delete({ where: { id: reviewId } });

    // 🚀 Update Item Cache (Background)
    await updateItemStats(review.itemId);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Delete failed' });
  }
};

/**
 * ⚡ Performance Helper: Atomic Item Stats Synchronization
 */
/**
 * 👮 Admin: Get review statistics (Star distribution)
 */
exports.getReviewStats = async (req, res) => {
  try {
    const reviewWhere = {};
    const orderWhere = { rating: { not: null } };

    if (req.user && (req.user.role === 'branch_manager' || req.user.role === 'manager')) {
      if (req.user.branchId) {
        reviewWhere.branchId = req.user.branchId;
        orderWhere.branchId = req.user.branchId;
      }
    }

    const [itemStats, orderStats] = await Promise.all([
      prisma.review.groupBy({
        by: ['rating'],
        where: reviewWhere,
        _count: { id: true }
      }),
      prisma.order.groupBy({
        by: ['rating'],
        where: orderWhere,
        _count: { id: true }
      })
    ]);

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    
    [...itemStats, ...orderStats].forEach(stat => {
      if (stat.rating) distribution[stat.rating] += stat._count.id;
    });

    res.json({ success: true, data: distribution });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
};

/**
 * ⚡ Performance Helper: Atomic Item Stats Synchronization
 */
async function updateItemStats(itemId) {
  // 🛡️ [FIX] Use transaction for atomic aggregation and update
  await prisma.$transaction(async (tx) => {
    const stats = await tx.review.aggregate({
      where: { itemId, status: 'APPROVED' },
      _avg: { rating: true },
      _count: { id: true }
    });

    await tx.item.update({
      where: { id: itemId },
      data: {
        cachedAvgRating: stats._avg.rating || 0,
        cachedReviewCount: stats._count.id || 0
      }
    });
  });

  // 🧹 [CACHE-FIX] Synchronize caching layer to ensure public averages immediately reflect updates
  try {
    const menuCacheService = require('../services/menuCacheService');
    if (menuCacheService && typeof menuCacheService.invalidate === 'function') {
      await menuCacheService.invalidate();
    }
  } catch (cacheErr) {
    logger.warn('[ReviewController] Menu cache invalidation skipped', { error: cacheErr.message });
  }
}
