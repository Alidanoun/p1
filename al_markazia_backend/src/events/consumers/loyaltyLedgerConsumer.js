const StreamConsumerGroup = require('../streamConsumerGroup');
const container = require('../../lib/container');
const logger = require('../../utils/logger');

/**
 * 🥈 Priority 2 Stream Consumer: Loyalty Ledger
 * Implements strict financial side-effect execution for loyalty awarding and tier upgrades.
 */
const loyaltyLedgerConsumer = new StreamConsumerGroup(
  'cg:loyalty_ledger',
  `worker-${process.env.INSTANCE_ID || 'node-1'}`,
  {
    /**
     * 🎁 Handle Order-Based Rewards
     * Emitted when an order transitions to 'delivered'.
     */
    'loyalty.order_award': async (event) => {
      const { payload } = event;
      const { orderId, customerId, points, multiplier } = payload;
      const loyaltyLedgerService = container.loyaltyLedgerService;

      const entry = await loyaltyLedgerService.credit(
        customerId,
        points,
        'ORDER_AWARD',
        orderId,
        `مكافأة الطلب #${payload.orderNumber}`,
        `order:award:${orderId}`, // Idempotency Key
        { multiplier }
      );
      
      // 🔄 [PHASE 4] Sync Projection
      await loyaltyLedgerService.syncProjection(customerId, entry.balanceAfter);

      logger.info(`[LoyaltyConsumer] Successfully processed Order Award for order #${orderId}`);
    },

    /**
     * ✍️ Handle Review-Based Rewards
     * Emitted when a review is approved by an admin.
     */
    'loyalty.review_award': async (event) => {
      const { payload } = event;
      const { reviewId, customerId, points } = payload;
      const loyaltyLedgerService = container.loyaltyLedgerService;

      const entry = await loyaltyLedgerService.credit(
        customerId,
        points,
        'REVIEW_AWARD',
        reviewId,
        'مكافأة تقييم وجبة',
        `review:award:${reviewId}` // Idempotency Key
      );

      // 🔄 [PHASE 4] Sync Projection
      await loyaltyLedgerService.syncProjection(customerId, entry.balanceAfter);
    },

    /**
     * 📱 Handle Social-Based Rewards
     */
    'loyalty.social_reward': async (event) => {
      const { payload } = event;
      const { customerId, points, action, date } = payload;
      const loyaltyLedgerService = container.loyaltyLedgerService;

      const entry = await loyaltyLedgerService.credit(
        customerId,
        points,
        'SOCIAL_AWARD',
        null,
        'مكافأة مشاركة منتج',
        `social:${customerId}:${action}:${date}` // Idempotency Key
      );

      // 🔄 [PHASE 4] Sync Projection
      await loyaltyLedgerService.syncProjection(customerId, entry.balanceAfter);
    },

    /**
     * 🎟️ Handle Referral-Based Rewards
     */
    'loyalty.referral_award': async (event) => {
      const { payload } = event;
      const { referrerCustomerId, referredCustomerId, points, orderId } = payload;
      const loyaltyLedgerService = container.loyaltyLedgerService;

      const entry = await loyaltyLedgerService.credit(
        referrerCustomerId,
        points,
        'REFERRAL_AWARD',
        referredCustomerId,
        'مكافأة دعوة صديق',
        `referral:${referrerCustomerId}:${referredCustomerId}:${orderId}` // Idempotency Key
      );

      // 🔄 [PHASE 4] Sync Projection
      await loyaltyLedgerService.syncProjection(referrerCustomerId, entry.balanceAfter);
    },

    /**
     * 👮 Handle Administrative Adjustments
     */
    'loyalty.manual_adjustment': async (event) => {
      const { payload } = event;
      const { customerId, points, type, reason, adminId, requestId } = payload;
      const loyaltyLedgerService = container.loyaltyLedgerService;

      let entry;
      if (type === 'CREDIT') {
        entry = await loyaltyLedgerService.credit(customerId, points, 'ADJUSTMENT', null, reason, `admin:adj:${requestId}`, { adminId });
      } else {
        entry = await loyaltyLedgerService.debit(customerId, points, 'ADJUSTMENT', null, reason, `admin:adj:${requestId}`, { adminId });
      }

      // 🔄 [PHASE 4] Sync Projection
      await loyaltyLedgerService.syncProjection(customerId, entry.balanceAfter);
    },

    /**
     * 🏁 General fallback for legacy event support
     */
    '*': async (event) => {
       // Legacy events skip the ledger for now to prevent breaking historical flows 
       // during the transition period.
       logger.debug(`[LoyaltyConsumer] Ignoring legacy/unhandled event: ${event.type}`);
    }
  }
);

module.exports = loyaltyLedgerConsumer;
