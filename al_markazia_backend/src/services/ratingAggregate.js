const redis = require('../lib/redis');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

/**
 * 📊 Rating Aggregate Service (Phase 1 Performance)
 * Implements Write-Aggregate, Read-Cache pattern using Redis HASH.
 */
class RatingAggregateService {
  /**
   * Updates aggregates in Redis for a given review.
   * Logic: O(1) HINCRBY
   */
  async updateFromReview(reviewId) {
    try {
      const review = await prisma.review.findUnique({
        where: { id: reviewId },
        include: { order: true }
      });

      if (!review || review.status !== 'APPROVED') return;

      const { branchId, driverId, rating } = review;

      const pipeline = redis.pipeline();

      // 1. Update Branch Stats
      if (branchId) {
        pipeline.hincrby(`rating:branch:${branchId}`, 'sum', rating);
        pipeline.hincrby(`rating:branch:${branchId}`, 'count', 1);
        pipeline.expire(`rating:branch:${branchId}`, 604800); // 7 days TTL
      }

      // 2. Update Driver Stats
      if (driverId) {
        pipeline.hincrby(`rating:driver:${driverId}`, 'sum', rating);
        pipeline.hincrby(`rating:driver:${driverId}`, 'count', 1);
        pipeline.expire(`rating:driver:${driverId}`, 604800);
      }

      await pipeline.exec();
      logger.info('[RatingAggregate] 📈 Aggregates updated', { reviewId, branchId, driverId });
    } catch (err) {
      logger.error('[RatingAggregate] ❌ Update failed', { error: err.message });
    }
  }

  /**
   * Reads the current average for a branch or driver.
   * Logic: sum / count
   */
  async getStats(type, id) {
    try {
      const stats = await redis.hgetall(`rating:${type}:${id}`);
      
      if (!stats || !stats.count) {
        return { average: 0, count: 0 };
      }

      const sum = parseInt(stats.sum) || 0;
      const count = parseInt(stats.count) || 0;

      return {
        average: count > 0 ? parseFloat((sum / count).toFixed(2)) : 0,
        count
      };
    } catch (err) {
      logger.error('[RatingAggregate] ❌ Fetch failed', { error: err.message });
      return { average: 0, count: 0 };
    }
  }
}

module.exports = new RatingAggregateService();
