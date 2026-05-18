const StreamConsumerGroup = require('../streamConsumerGroup');
const logger = require('../../utils/logger');
const redis = require('../../lib/redis');
const container = require('../../lib/container');
const eventTypes = require('../eventTypes');

/**
 * 💰 Financial Rollback Consumer
 * Purpose: Handles wallet refunds and loyalty point reversals after order cancellation.
 * Idempotency: Enforced via Redis and Ledger idempotency keys.
 */
const financialRollbackConsumer = new StreamConsumerGroup(
  'cg:financial_rollback',
  `fin-rollback-${process.env.INSTANCE_ID || 'node-1'}`,
  {
    [eventTypes.ORDER_FINANCIAL_ROLLBACK]: async (event) => {
      const { payload } = event;
      const { orderId, total, customerId, pointsDiscount, pointsAwarded, branchId, items, actor } = payload;

      if (!orderId) {
        logger.warn('[FinancialRollbackConsumer] Missing orderId. Skipping.');
        return;
      }

      try {
        await container.prisma.$transaction(async (tx) => {
          // 1. 💳 Wallet Refund
          if (customerId && payload.paymentMethod === 'wallet' && total > 0) {
             await container.walletService.credit(
              customerId,
              total,
              'REFUND',
              orderId.toString(),
              `Refund for cancelled order #${orderId}`,
              `cancel_wallet_refund:${orderId}`,
              tx
            );
          } else if (total > 0) {
             logger.info(`[FinancialRollbackConsumer] Order #${orderId} payment method was '${payload.paymentMethod || 'unknown'}'. Skipping wallet refund.`);
          }

          // 2. 🎁 Loyalty Reversal (Clawback awarded points)
          if (customerId && pointsAwarded) {
            await container.loyaltyLedgerService.debit(
              customerId,
              pointsAwarded,
              'CLAWBACK',
              orderId.toString(),
              `Clawback for cancelled order #${orderId}`,
              `cancel_loyalty_clawback:${orderId}`,
              {},
              tx
            );
            
            // Cleanup awarded record if it exists
            await tx.awardedLoyaltyPoints.deleteMany({
              where: { orderId: parseInt(orderId) }
            });
          }

          // 3. 🎁 Redemption Refund (Credit back spent points)
          if (customerId && Number(pointsDiscount) > 0) {
            const redemption = await tx.loyaltyLedger.findFirst({
              where: { customerId, category: 'REDEMPTION', referenceId: String(orderId) }
            });

            if (redemption) {
              const pointsToRefund = Math.abs(redemption.points);
              await container.loyaltyLedgerService.credit(
                customerId,
                pointsToRefund,
                'REDEMPTION_REFUND',
                orderId.toString(),
                `Points refund for cancelled order #${orderId}`,
                `cancel_loyalty_refund:${orderId}`,
                {},
                tx
              );
            }
          }

          // 📝 Audit the side-effect
          await tx.orderAuditLog.create({
            data: {
              orderId: parseInt(orderId),
              eventType: 'FINANCIAL_RECONCILIATION',
              eventAction: 'ROLLBACK_COMPLETED',
              changedBy: actor?.email || 'system',
              changedByRole: actor?.role || 'system',
              newData: JSON.stringify({ total, pointsDiscount, pointsAwarded }),
              createdAt: new Date()
            }
          });

          // 🔗 Chain next step: Inventory Restock
          const nextEvent = await container.outboxService.enqueue(tx, {
            type: eventTypes.ORDER_INVENTORY_RESTOCK,
            aggregateId: orderId,
            aggregateType: 'Order',
            payload: { orderId, branchId, items, autoDecremented: true, actor }
          });
          
          await container.outboxService.immediateDispatch(nextEvent.id);
          
          logger.info(`[FinancialRollbackConsumer] ✅ Successfully rolled back finances for #${orderId}`);
        });
      } catch (err) {
        logger.error(`[FinancialRollbackConsumer] Failed for #${orderId}`, { error: err.message });
        throw err; // StreamConsumerGroup will handle retries and state-based idempotency
      }
    }
  }
);

module.exports = financialRollbackConsumer;
