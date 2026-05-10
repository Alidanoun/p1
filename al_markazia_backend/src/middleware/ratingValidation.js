const { z } = require('zod');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

/**
 * 📏 Rating Validation Schema (Phase 1 Governance)
 */
const ratingSchema = z.object({
  orderId: z.number().int(),
  itemId: z.number().int(),
  rating: z.number().min(1).max(5),
  comment: z.string().max(500).optional(),
  images: z.array(z.string().url()).optional()
});

/**
 * 🛡️ Rating Validation Middleware
 * Checks: 72h window, Ownership, Unique per Order-Item.
 */
const validateRating = async (req, res, next) => {
  try {
    const validatedData = ratingSchema.parse(req.body);
    const { orderId, itemId } = validatedData;
    const customerId = req.user.id; // From JWT

    // 1. Fetch Order and check ownership + status
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true }
    });

    if (!order || order.customerId !== customerId) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود أو لا يخصك' });
    }

    if (order.status !== 'delivered' && order.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'لا يمكنك تقييم طلب لم يتم تسليمه بعد' });
    }

    // 2. Check 72h Window
    const deliveryTime = order.updatedAt; // Assuming it was delivered at last update
    const diffHours = (Date.now() - new Date(deliveryTime).getTime()) / (1000 * 60 * 60);
    
    if (diffHours > 72) {
      return res.status(400).json({ success: false, message: 'انتهت الفترة المتاحة للتقييم (72 ساعة)' });
    }

    // 3. Verify Item exists in Order
    const itemInOrder = order.orderItems.find(oi => oi.itemId === itemId);
    if (!itemInOrder) {
      return res.status(400).json({ success: false, message: 'هذا الصنف ليس جزءاً من الطلب المحدد' });
    }

    // 4. Check for existing rating (Unique Constraint Check)
    const existing = await prisma.review.findUnique({
      where: {
        customerId_orderId_itemId: { customerId, orderId, itemId }
      }
    });

    if (existing) {
      return res.status(400).json({ success: false, message: 'لقد قمت بتقييم هذا الصنف مسبقاً لهذا الطلب' });
    }

    req.validatedRating = validatedData;
    req.orderContext = order;
    next();
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, errors: err.errors });
    }
    logger.error('[RatingValidation] Error', { error: err.message });
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء التحقق من التقييم' });
  }
};

module.exports = { validateRating };
