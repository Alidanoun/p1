const { Queue, Worker } = require('bullmq');
const redis = require('../lib/redis');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { analyzeContent } = require('../utils/contentFilter');
const ratingAggregate = require('../services/ratingAggregate');

const moderationQueue = new Queue('moderation', {
  connection: redis.options
});

let moderationWorker;
if (process.env.NODE_ENV !== 'test') {
  moderationWorker = new Worker('moderation', async (job) => {
    const { reviewId } = job.data;
    
    try {
      const review = await prisma.review.findUnique({
        where: { id: reviewId },
        include: { order: true }
      });

      if (!review) return;

      const { isClean, flags } = analyzeContent(review.comment);

      if (isClean) {
        // ✅ Auto-Approve
        await prisma.review.update({
          where: { id: reviewId },
          data: { status: 'APPROVED' }
        });
        
        // 📊 Update Redis Aggregates (Write-Aggregate)
        await ratingAggregate.updateFromReview(reviewId);
        
        logger.info(`[Moderation] ✅ Auto-approved review ${reviewId}`);
      } else {
        // 🚩 Flag for manual review
        await prisma.review.update({
          where: { id: reviewId },
          data: { status: 'FLAGGED', isFlagged: true, rejectedReason: flags.join(', ') }
        });
        
        logger.warn(`[Moderation] 🚩 Flagged review ${reviewId}`, { flags });
      }
    } catch (err) {
      logger.error(`[Moderation] ❌ Worker failed for review ${reviewId}`, { error: err.message });
      throw err;
    }
  }, {
    connection: redis.options
  });
}

module.exports = { moderationQueue };
