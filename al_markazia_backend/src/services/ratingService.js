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

    // 🛡️ Resolve Customer Int ID from UUID
    const customer = await prisma.customer.findUnique({
      where: { uuid: customerId },
      select: { id: true }
    });

    if (!customer) {
      throw new Error('CUSTOMER_NOT_FOUND');
    // Fetch branchId from order
    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!order) {
      throw new Error('ORDER_NOT_FOUND');
    }

    const review = await prisma.review.create({
      data: {
        orderId,
        itemId,
        customerId: customer.id,
        rating,
        comment,
        images: images || [],
        fingerprint,
        branchId: order.branchId,
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
