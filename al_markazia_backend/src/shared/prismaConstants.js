/**
 * 📦 Prisma Query Constants — Single Source of Truth
 * Ensures all order queries return the same shape for consistent mapper output.
 */

const ORDER_INCLUDE_FULL = {
  orderItems: true,
  customer: true,
  cancellation: true,
};

module.exports = { ORDER_INCLUDE_FULL };
