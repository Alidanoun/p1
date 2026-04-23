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
    const userUuid = req.user.id; // From JWT

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
    // Check if customer has a completed order containing this item
    const purchasedOrder = await prisma.order.findFirst({
      where: {
        customerId: customer.id,
        status: 'delivered', // or 'completed' depending on your business flow
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

    // 4. Duplicate Check (One review per customer per item)
    const existing = await prisma.review.findUnique({
      where: { customerId_itemId: { customerId: customer.id, itemId: itemIdInt } }
    });

    if (existing) {
      return res.status(409).json({ 
        error: 'لقد قمت بتقييم هذا الصنف مسبقاً',
        code: 'ALREADY_REVIEWED'
      });
    }

    // 5. Content Sanitization & Safety
    const cleanComment = sanitizeComment(comment);
    if (cleanComment) {
      const safety = isContentSafe(cleanComment);
      if (!safety.safe) {
        logger.security('Unsafe review content blocked', { customerId: customer.id, reason: safety.reason });
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
        isApproved: ratingInt > 2, // Auto-approve if rating > 2, else wait for admin
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')?.substring(0, 200)
      },
      include: {
          item: { select: { title: true } }
      }
    });

    // 7. Real-time Admin Notification
    const io = req.app.get('io');
    if (io) {
      io.to(SOCKET_ROOMS.ADMIN).emit(SOCKET_EVENTS.NEW_REVIEW, { 
          review, 
          message: `تقييم جديد للصنف: ${review.item.title}` 
      });
    }

    res.status(201).json({ success: true, review });
  } catch (error) {
    logger.error('Submit review error:', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'فشل إرسال التقييم' });
  }
};

/**
 * 📖 Public: Fetch approved reviews for an item
 */
exports.getItemReviews = async (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId);
    if (isNaN(itemId)) return res.status(400).json({ error: 'Item ID is required' });

    const reviews = await prisma.review.findMany({
      where: { itemId, isApproved: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        rating: true,
        comment: true,
        isVerifiedPurchase: true,
        createdAt: true,
        customer: { select: { name: true } }
      }
    });

    res.json(reviews);
  } catch (error) {
    logger.error('Get item reviews error:', error);
    res.status(500).json({ error: 'فشل جلب التقييمات' });
  }
};

/**
 * 👮 Admin: Fetch all reviews (Consolidated)
 */
exports.getAllReviews = async (req, res) => {
  try {
    // 1. Item Reviews
    const itemReviews = await prisma.review.findMany({
      include: {
        item: { select: { title: true, id: true, image: true } },
        customer: { select: { name: true, phone: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    const mappedItemReviews = itemReviews.map(r => ({
      ...r,
      type: 'item_review',
      customerName: r.customer.name,
      customerPhone: r.customer.phone
    }));

    // 2. Order Ratings (Legacy/Direct)
    const orderRatings = await prisma.order.findMany({
      where: { rating: { not: null } },
      include: { orderItems: true },
      orderBy: { createdAt: 'desc' }
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

    res.json(all);
  } catch (error) {
    logger.error('Get all reviews error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      await prisma.order.update({
        where: { id: realId },
        data: { isRatingApproved: Boolean(isApproved) }
      });
      return res.json({ success: true });
    }

    const review = await prisma.review.update({
      where: { id: parseInt(id) },
      data: { isApproved: Boolean(isApproved), isFlagged: false }
    });
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
    const { id } = req.params;
    await prisma.review.update({
      where: { id: parseInt(id) },
      data: { isFlagged: true }
    });
    res.json({ success: true, message: 'Review flagged for moderation' });
  } catch (error) {
    res.status(500).json({ error: 'Action failed' });
  }
};

/**
 * 👮 Admin: Delete a review
 */
exports.deleteReview = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.review.delete({ where: { id: parseInt(id) } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Delete failed' });
  }
};
