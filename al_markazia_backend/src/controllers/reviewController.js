const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { sanitizeComment, isContentSafe } = require('../services/contentFilter');
const { SOCKET_EVENTS, SOCKET_ROOMS } = require('../shared/socketEvents');

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

    // 4. Duplicate Check
    const existing = await prisma.review.findUnique({
      where: { customerId_itemId: { customerId: customer.id, itemId: itemIdInt } }
    });

    if (existing) {
      return res.status(409).json({ 
        error: 'لقد قمت بتقييم هذا الصنف مسبقاً',
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
        isApproved: ratingInt > 2,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')?.substring(0, 200)
      },
      include: { item: { select: { title: true } } }
    });

    const io = req.app.get('io');
    if (io) {
      io.to(SOCKET_ROOMS.ADMIN).emit(SOCKET_EVENTS.NEW_REVIEW, { review });
    }

    res.status(201).json({
      success: true,
      data: review
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
        where: { itemId, isApproved: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          rating: true,
          comment: true,
          isVerifiedPurchase: true,
          createdAt: true,
          customer: { select: { name: true } }
        }
      }),
      prisma.review.count({ where: { itemId, isApproved: true } })
    ]);

    res.json({
      success: true,
      data: reviews,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    logger.error('Fetch item reviews error', { itemId: req.params.itemId, error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch reviews' });
  }
};

/**
 * 👮 Admin: Fetch all reviews (Consolidated + Pagination)
 */
exports.getAllReviews = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;

    const itemReviews = await prisma.review.findMany({
      include: {
        item: { select: { title: true, id: true, image: true } },
        customer: { select: { name: true, phone: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });

    const mappedItemReviews = itemReviews.map(r => ({
      ...r,
      type: 'item_review',
      customerName: r.customer.name,
      customerPhone: r.customer.phone
    }));

    const orderRatings = await prisma.order.findMany({
      where: { rating: { not: null } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });

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
      orderNumber: o.orderNumber
    }));

    const all = [...mappedItemReviews, ...mappedOrderRatings].sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json({ success: true, data: all });
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

    if (typeof id === 'string' && id.startsWith('order-')) {
      const realId = parseInt(id.replace('order-', ''));
      if (isNaN(realId)) return res.status(400).json({ error: 'Invalid Order ID' });
      
      await prisma.order.update({
        where: { id: realId },
        data: { isRatingApproved: Boolean(isApproved) }
      });
      return res.json({ success: true });
    }

    const reviewId = parseInt(id);
    if (isNaN(reviewId)) return res.status(400).json({ error: 'Invalid Review ID' });

    const review = await prisma.review.update({
      where: { id: reviewId },
      data: { isApproved: Boolean(isApproved), isFlagged: false }
    });

    // 🚀 Update Item Cache (Background)
    updateItemStats(review.itemId).catch(e => logger.error('Cache update failed', { error: e.message }));

    res.json(review);
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
 * 👮 Admin: Delete a review
 */
exports.deleteReview = async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id);
    if (isNaN(reviewId)) return res.status(400).json({ error: 'Invalid ID' });

    const review = await prisma.review.delete({ where: { id: reviewId } });

    // 🚀 Update Item Cache (Background)
    updateItemStats(review.itemId).catch(e => logger.error('Cache update failed', { error: e.message }));

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Delete failed' });
  }
};

/**
 * ⚡ Performance Helper: Atomic Item Stats Synchronization
 */
async function updateItemStats(itemId) {
  const stats = await prisma.review.aggregate({
    where: { itemId, isApproved: true },
    _avg: { rating: true },
    _count: { id: true }
  });

  await prisma.item.update({
    where: { id: itemId },
    data: {
      cachedAvgRating: stats._avg.rating || 0,
      cachedReviewCount: stats._count.id || 0
    }
  });
}
