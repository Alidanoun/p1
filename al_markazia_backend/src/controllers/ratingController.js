const ratingService = require('../services/ratingService');
const ratingAggregate = require('../services/ratingAggregate');
const logger = require('../utils/logger');

/**
 * 🎨 Rating Controller (Phase 1)
 */
class RatingController {
  /**
   * POST /api/v1/ratings
   */
  async submit(req, res) {
    try {
      const review = await ratingService.createReview(
        req.validatedRating,
        req.user.id,
        req.fingerprint
      );

      res.status(202).json({
        success: true,
        message: 'تم استلام تقييمك، سيظهر بعد المراجعة قريباً',
        data: { reviewId: review.id, status: review.status }
      });
    } catch (err) {
      logger.error('[RatingController] Submit error', { error: err.message });
      res.status(500).json({ success: false, message: 'حدث خطأ أثناء إرسال التقييم' });
    }
  }

  /**
   * GET /api/v1/ratings/item/:itemId
   */
  async getItemReviews(req, res) {
    try {
      const { itemId } = req.params;
      const { cursor, limit } = req.query;

      const result = await ratingService.getItemReviews(
        parseInt(itemId),
        cursor,
        parseInt(limit) || 10
      );

      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/v1/ratings/stats/:type/:id
   */
  async getStats(req, res) {
    try {
      const { type, id } = req.params; // type: branch
      const stats = await ratingAggregate.getStats(type, id);
      res.json({ success: true, data: stats });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}

module.exports = new RatingController();
