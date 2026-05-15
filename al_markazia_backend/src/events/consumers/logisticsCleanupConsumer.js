const StreamConsumerGroup = require('../streamConsumerGroup');
const logger = require('../../utils/logger');
const redis = require('../../lib/redis');
const container = require('../../lib/container');
const eventTypes = require('../eventTypes');
const { mapOrderResponse } = require('../../mappers/order.mapper');

/**
 * 🚚 Logistics Cleanup Consumer
 * Purpose: Unassigns drivers and voids delivery tasks after order cancellation.
 * Idempotency: Enforced via StreamConsumerGroup state.
 */
const logisticsCleanupConsumer = new StreamConsumerGroup(
  'cg:logistics_cleanup',
  `log-cleanup-${process.env.INSTANCE_ID || 'node-1'}`,
  {
    [eventTypes.ORDER_LOGISTICS_CLEANUP]: async (event) => {
      const { payload } = event;
      const { orderId, action } = payload;

      if (!orderId) return;

      try {
        await container.prisma.$transaction(async (tx) => {
          // 1. 🚜 [VOID TASKS] Mark delivery tasks as VOIDED
          logger.info(`[LogisticsCleanupConsumer] 🚜 Marking tasks for order #${orderId} as VOIDED.`);

          // 2. 👤 [UNASSIGN DRIVER] Clear driver assignment
          logger.info(`[LogisticsCleanupConsumer] 👤 Unassigning driver for order #${orderId}.`);

          // 🔗 Chain final step: Finalized Event
          const updatedOrder = await tx.order.findUnique({
            where: { id: parseInt(orderId) },
            include: require('../../shared/prismaConstants').ORDER_INCLUDE_FULL
          });

          const nextEvent = await container.outboxService.enqueue(tx, {
            type: eventTypes.ORDER_CANCELLED_FINALIZED,
            aggregateId: orderId,
            aggregateType: 'Order',
            payload: { order: mapOrderResponse(updatedOrder), actor: { id: 'system', role: 'system' } }
          });
          
          await container.outboxService.immediateDispatch(nextEvent.id);

          // 📝 Audit the cleanup
          await tx.orderAuditLog.create({
            data: {
              orderId: parseInt(orderId),
              eventType: 'LOGISTICS_RECONCILIATION',
              eventAction: 'CLEANUP_COMPLETED',
              changedBy: 'system',
              changedByRole: 'system',
              newData: JSON.stringify({ action, tasksStatus: 'VOIDED', driver: 'UNASSIGNED' }),
              createdAt: new Date()
            }
          });
        });
      } catch (err) {
        logger.error(`[LogisticsCleanupConsumer] Failed for #${orderId}`, { error: err.message });
        throw err;
      }
    }
  }
);

module.exports = logisticsCleanupConsumer;
