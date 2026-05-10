const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { moderationQueue } = require('../queues/moderationQueue');

/**
 * ⭐ Rating Service (Phase 1)
 */
class RatingService {
  /**
   * Creates a new review in PENDING status.
   */
  async createReview(data, customerId, fingerprint) {
    const { orderId, itemId, rating, comment, images } = data;

    // Fetch branchId and driverId from order
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { branch: true }
    });

    const review = await prisma.review.create({
      data: {
        orderId,
        itemId,
        customerId,
        rating,
        comment,
        images: images || [],
        fingerprint,
        branchId: order.branchId,
        // driverId: order.driverId, // Assuming driverId is in Order model or related
        status: 'PENDING'
      }
    });

    // 🚀 Send to Moderation Queue (Async)
    await moderationQueue.add('moderate_review', { reviewId: review.id });

    return review;
  }

  /**
   * List approved reviews for an item (Phase 2: Cursor Pagination)
   */
  async getItemReviews(itemId, cursor, limit = 10) {
    const query = {
      where: {
        itemId,
        status: 'APPROVED'
      },
      include: {
        customer: {
          select: { name: true, profileImage: true }
        },
        replies: {
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { id: 'desc' }, // Predictable ordering for cursor
      take: limit + 1 // Take one extra to find the next cursor
    };

    if (cursor) {
      query.cursor = { id: parseInt(cursor) };
      query.skip = 1; // Skip the cursor itself
    }

    const reviews = await prisma.review.findMany(query);

    let nextCursor = null;
    if (reviews.length > limit) {
      const nextItem = reviews.pop();
      nextCursor = nextItem.id;
    }

    return {
      reviews,
      nextCursor
    };
  }
}

module.exports = new RatingService();
