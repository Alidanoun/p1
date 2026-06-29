const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const ratingAggregate = require('../services/ratingAggregate');
const notificationService = require('../services/notificationService');

/**
 * 🛠️ Admin Moderation Controller (Fixed V2)
 */
class AdminModerationController {
  /**
   * GET /api/v1/admin/ratings/pending
   */
  async getPendingReviews(req, res) {
    try {
      const { status = 'PENDING', page = 1, limit = 20 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const filter = { status };
      
      // 🛡️ [SEC-FIX] Branch Manager Isolation
      if (req.user.role === 'branch_manager' || req.user.role === 'manager') {
        if (req.user.branchId) {
          filter.branchId = req.user.branchId;
        }
      }

      const [reviews, total] = await Promise.all([
        prisma.review.findMany({
          where: filter,
          include: {
            customer: { select: { name: true, phone: true } },
            item: { select: { title: true } },
            order: { select: { orderNumber: true } }
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: parseInt(limit)
        }),
        prisma.review.count({ where: filter })
      ]);

      res.json({
        success: true,
        data: reviews,
        pagination: { total, page: parseInt(page), limit: parseInt(limit) }
      });
    } catch (err) {
      logger.error('Get reviews error', { error: err.message });
      res.status(500).json({ success: false, message: 'فشل جلب التقييمات' });
    }
  }

  /**
   * PATCH /api/v1/admin/ratings/:id/status
   */
  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, rejectedReason } = req.body;

      const reviewToUpdate = await prisma.review.findUnique({
        where: { id: parseInt(id) }
      });
      if (!reviewToUpdate) return res.status(404).json({ success: false, message: 'التقييم غير موجود' });

      if (req.user.role !== 'admin' && reviewToUpdate.branchId !== req.user.branchId) {
        return res.status(403).json({ success: false, message: 'ACCESS_DENIED' });
      }

      const review = await prisma.review.update({
        where: { id: parseInt(id) },
        data: { status, rejectedReason },
        include: { customer: true }
      });

      if (status === 'APPROVED') {
        await ratingAggregate.updateFromReview(review.id);
        
        await notificationService.sendDirectNotification(
          review.customer.phone,
          'تمت الموافقة على تقييمك! 🌟',
          'شكراً لمشاركتك رأيك معنا، تقييمك الآن ظاهر للجميع.',
          { type: 'REVIEW_APPROVED', reviewId: review.id }
        );
      }

      res.json({ success: true, message: `تم تحديث حالة التقييم إلى ${status}` });
    } catch (err) {
      res.status(500).json({ success: false, message: 'فشل تحديث الحالة' });
    }
  }

  /**
   * POST /api/v1/admin/ratings/:id/reply
   */
  async postReply(req, res) {
    try {
      const { id } = req.params;
      const { content } = req.body;
      const authorId = req.user.id;
      const authorRole = req.user.role || 'ADMIN';

      const review = await prisma.review.findUnique({
        where: { id: parseInt(id) }
      });
      if (!review) return res.status(404).json({ success: false, message: 'التقييم غير موجود' });

      if (req.user.role !== 'admin' && review.branchId !== req.user.branchId) {
        return res.status(403).json({ success: false, message: 'ACCESS_DENIED' });
      }

      const reply = await prisma.reply.create({
        data: {
          reviewId: parseInt(id),
          authorId,
          authorRole,
          content
        },
        include: { review: { include: { customer: true } } }
      });

      await notificationService.sendDirectNotification(
        reply.review.customer.phone,
        'رد جديد على تقييمك 💬',
        'قامت الإدارة بالرد على تقييمك الأخير، تفقد الرد الآن.',
        { type: 'REVIEW_REPLY', reviewId: id }
      );

      res.json({ success: true, data: reply });
    } catch (err) {
      res.status(500).json({ success: false, message: 'فشل إرسال الرد' });
    }
  }
}

module.exports = new AdminModerationController();
