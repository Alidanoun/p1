const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const ratingAggregate = require('../services/ratingAggregate');
const notificationService = require('../services/notificationService');

/**
 * 🛠️ Admin Moderation Controller (Phase 2 Interaction)
 */
class AdminModerationController {
  /**
   * GET /api/v1/admin/ratings/pending
   */
  async getPendingReviews(req, res) {
    try {
      const { status = 'PENDING', page = 1, limit = 20 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const reviews = await prisma.review.findMany({
        where: { status },
        include: {
          customer: { select: { name: true, phone: true } },
          item: { select: { name: true } },
          order: { select: { orderNumber: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      });

      const total = await prisma.review.count({ where: { status } });

      res.json({
        success: true,
        data: reviews,
        pagination: { total, page: parseInt(page), limit: parseInt(limit) }
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * PATCH /api/v1/admin/ratings/:id/status
   */
  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, rejectedReason } = req.body;

      const review = await prisma.review.update({
        where: { id: parseInt(id) },
        data: { status, rejectedReason },
        include: { customer: true }
      });

      if (status === 'APPROVED') {
        // 📊 Update aggregates
        await ratingAggregate.updateFromReview(review.id);
        
        // 🔔 Notify Customer
        await notificationService.sendDirectNotification(
          review.customer.phone,
          'تمت الموافقة على تقييمك! 🌟',
          'شكراً لمشاركتك رأيك معنا، تقييمك الآن ظاهر للجميع.',
          { type: 'REVIEW_APPROVED', reviewId: review.id }
        );
      }

      res.json({ success: true, message: `تم تحديث حالة التقييم إلى ${status}` });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/v1/admin/ratings/:id/reply
   */
  async postReply(req, res) {
    try {
      const { id } = req.params;
      const { content } = req.body;
      const authorId = req.user.uuid; // Admin UUID
      const authorRole = req.user.role || 'ADMIN';

      const reply = await prisma.reply.create({
        data: {
          reviewId: parseInt(id),
          authorId,
          authorRole,
          content
        },
        include: { review: { include: { customer: true } } }
      });

      // 🔔 Notify Customer about reply
      await notificationService.sendDirectNotification(
        reply.review.customer.phone,
        'رد جديد على تقييمك 💬',
        'قامت الإدارة بالرد على تقييمك الأخير، تفقد الرد الآن.',
        { type: 'REVIEW_REPLY', reviewId: id }
      );

      res.json({ success: true, data: reply });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}

module.exports = new AdminModerationController();
