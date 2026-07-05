const logger = require('../../utils/logger');

/**
 * 🎁 Loyalty Event Handler
 * Consumes events from the Redis Stream backbone and processes loyalty rewards.
 *
 * Design: Parallel (Hybrid) pattern — the direct call in orderService already
 * ENQUEUES to Outbox (no direct loyaltyService.award call). This handler is
 * the CONSUMER that completes the at-least-once delivery guarantee.
 *
 * Events handled:
 *   - loyalty.order_award:   Award points for a delivered order
 *   - loyalty.referral_award: Award points for a referral on first order
 */

async function onOrderAward(event, messageId) {
  const { payload } = event;
  const { orderId, customerId, points, orderNumber } = payload;

  logger.info(`[LoyaltyHandler] Processing loyalty.order_award`, { orderId, customerId, points });

  try {
    const container = require('../../lib/container');
    const loyaltyService = container.loyaltyService;

    // Use a deterministic idempotencyKey derived from the event ID
    // This guarantees that even if the worker crashes and replays the event,
    // points are never double-awarded.
    const idempotencyKey = `loyalty_award:order:${orderId}`;

    await loyaltyService.awardPointsForOrder(
      customerId,
      orderId,
      points,
      idempotencyKey
    );

    logger.info(`[LoyaltyHandler] ✅ Points awarded`, { customerId, orderId, points });
  } catch (err) {
    logger.error(`[LoyaltyHandler] ❌ Failed to award points for order ${orderId}`, { error: err.message });
    throw err; // Re-throw so StreamConsumerGroup keeps the message in PEL for retry
  }
}

async function onReferralAward(event, messageId) {
  const { payload } = event;
  const { referrerCustomerId, referredCustomerId, points, orderId } = payload;

  logger.info(`[LoyaltyHandler] Processing loyalty.referral_award`, { referrerCustomerId, orderId });

  try {
    const container = require('../../lib/container');
    const loyaltyService = container.loyaltyService;

    const idempotencyKey = `loyalty_referral:${referrerCustomerId}:${referredCustomerId}:${orderId}`;

    await loyaltyService.awardEngagementPoints(
      referrerCustomerId,
      'REFERRAL',
      idempotencyKey
    );

    logger.info(`[LoyaltyHandler] ✅ Referral points awarded`, { referrerCustomerId, points });
  } catch (err) {
    logger.error(`[LoyaltyHandler] ❌ Failed to award referral points`, { referrerCustomerId, error: err.message });
    throw err;
  }
}

module.exports = { onOrderAward, onReferralAward };
