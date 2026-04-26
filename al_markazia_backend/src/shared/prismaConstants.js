/**
 * 📦 Prisma Query Constants — Single Source of Truth
 * Ensures all order queries return the same shape for consistent mapper output.
 * Optimized to prevent N+1 and over-fetching.
 */

const ORDER_INCLUDE_FULL = {
  customer: {
    select: {
      id: true,
      uuid: true,
      name: true,
      phone: true,
      isBlacklisted: true
    }
  },
  orderItems: {
    orderBy: { id: 'asc' },
    include: {
      item: {
        select: {
          image: true
        }
      }
    }
  },
  cancellation: true,
};

module.exports = { ORDER_INCLUDE_FULL };
