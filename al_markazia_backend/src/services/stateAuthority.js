const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { ORDER_INCLUDE_FULL } = require('../shared/prismaConstants');
const { mapOrderResponse } = require('../mappers/order.mapper');

/**
 * 🧠 State Authority Layer (Canonical Source of Truth)
 * Purpose: Ensures all layers receive the same validated state from DB.
 */
class StateAuthority {
  /**
   * Fetches the full, canonical state of an order from the database.
   */
  async getCanonicalOrder(orderId) {
    try {
      const order = await prisma.order.findUnique({
        where: { id: parseInt(orderId) },
        include: ORDER_INCLUDE_FULL
      });

      if (!order) return null;

      // Map to standard response format (to ensure consistency with API)
      return mapOrderResponse(order);
    } catch (err) {
      logger.error('[StateAuthority] Failed to fetch canonical order', { orderId, error: err.message });
      return null;
    }
  }

  /**
   * Increments the state version of an aggregate.
   */
  async incrementVersion(orderId) {
    try {
      return await prisma.order.update({
        where: { id: parseInt(orderId) },
        data: { version: { increment: 1 } }
      });
    } catch (err) {
      logger.error('[StateAuthority] Version increment failed', { orderId });
      return null;
    }
  }
}

module.exports = new StateAuthority();
