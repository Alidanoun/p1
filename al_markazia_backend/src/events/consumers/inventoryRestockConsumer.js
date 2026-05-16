const StreamConsumerGroup = require('../streamConsumerGroup');
const container = require('../../lib/container');
const logger = require('../../utils/logger');
const redis = require('../../lib/redis');

const eventTypes = require('../eventTypes');

/**
 * 🥈 Priority 2 Stream Consumer: Inventory Restock Consumer
 * Revenue Integrity & Restocking Reconciliation Layer.
 * Ensures items from cancelled orders are atomically unreserved/restocked to prevent phantom stockouts.
 */
const inventoryRestockConsumer = new StreamConsumerGroup(
  'cg:inventory_restock',
  `restock-${process.env.INSTANCE_ID || 'node-1'}`,
  {
    'order.inventory_restock': async (event) => {
      const { payload, metadata } = event;
      const { orderId, branchId, items, autoDecremented, actor } = payload;

      if (!orderId || !items) {
        logger.warn('[InventoryRestockConsumer] Missing payload details. Skipping.');
        return;
      }

      // 🛡️ Distributed Idempotency Guard (Resilient 5-minute lease limit)
      const idempotencyKey = `idempotency:inventory_restock:${orderId}`;
      const currentStatus = await redis.get(idempotencyKey);
      
      if (currentStatus === 'COMPLETED') {
        logger.info(`[InventoryRestockConsumer] Event for #${orderId} already completed. Skipping.`);
        return;
      }
      
      if (currentStatus === 'PROCESSING') {
        logger.warn(`[InventoryRestockConsumer] Event for #${orderId} is currently being processed or previous attempt crashed. Skipping for retry.`);
        return;
      }

      const acquired = await redis.set(idempotencyKey, 'PROCESSING', 'NX', 'EX', 300);
      if (!acquired) return;

      try {
        await container.prisma.$transaction(async (tx) => {
          let restockedCount = 0;
          let skippedCount = 0;

          for (const item of items) {
            if (!item.itemId) continue;

            // 🔍 Rule #4: Check for Manual Admin Override
            // We search for the most recent manual toggle in the audit log
            const lastManualToggle = await tx.systemAuditLog.findFirst({
              where: {
                action: 'ITEM_AVAILABILITY_TOGGLED',
                entityType: 'Item',
                entityId: item.itemId.toString(),
                branchId: branchId
              },
              orderBy: { createdAt: 'desc' }
            });

            const isManuallyDisabled = lastManualToggle && 
                                      (lastManualToggle.metadata?.newState === false || 
                                       lastManualToggle.metadata?.newState === 'false');

            if (isManuallyDisabled) {
              logger.info(`[InventoryRestockConsumer] 🛑 Skipping restock for Item #${item.itemId} in Branch ${branchId}: Manually disabled by admin.`);
              skippedCount++;
              continue;
            }

            // ✅ Only restore if auto-decremented (or if we trust the intent)
            if (autoDecremented) {
              await tx.branchItem.updateMany({
                where: { branchId, itemId: item.itemId },
                data: { isAvailable: true }
              });
              restockedCount++;
            }
          }

          // 📝 Audit the decision
          await tx.orderAuditLog.create({
            data: {
              orderId,
              eventType: 'INVENTORY_RECONCILIATION',
              eventAction: 'RESTOCK_COMPLETED',
              changedBy: actor?.email || 'system',
              changedByRole: actor?.role || 'system',
              newData: JSON.stringify({ restockedCount, skippedCount, autoDecremented }),
              createdAt: new Date()
            }
          });

          logger.info(`[InventoryRestockConsumer] 📦 Reconciled inventory for #${orderId}: Restocked ${restockedCount}, Skipped ${skippedCount}`);

          // 🔗 Chain next step: Logistics Cleanup
          const nextEvent = await container.outboxService.enqueue(tx, {
            type: eventTypes.ORDER_LOGISTICS_CLEANUP,
            aggregateId: orderId,
            aggregateType: 'Order',
            payload: { orderId, action: 'VOID_TASKS', unassignDriver: true }
          });
          
          await container.outboxService.immediateDispatch(nextEvent.id);
        });

        await redis.set(idempotencyKey, 'COMPLETED', 'EX', 86400);
      } catch (err) {
        logger.error(`[InventoryRestockConsumer] Failed for #${orderId}`, { error: err.message });
        await redis.del(idempotencyKey);
        throw err;
      }
    }
  }
);

module.exports = inventoryRestockConsumer;
