const prisma = require('../lib/prisma');
const pricingService = require('./pricingService');
const walletService = require('./walletService');
const eventBus = require('../events/eventBus');
const eventTypes = require('../events/eventTypes');
const logger = require('../utils/logger');
const { toNumber } = require('../utils/number');

/**
 * 🔄 Order Modification State Machine
 * Manages the lifecycle of order changes (Replacement, Partial Cancel).
 */
class OrderModificationService {

  /**
   * 1️⃣ Step: Request Modification (Admin)
   * Creates a pending event and calculates the preview.
   */
  async requestModification(orderId, adminId, enrichedModifications) {
    const event = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new Error('ORDER_NOT_FOUND');

      const { oldSummary, newSummary, delta, ...modifications } = enrichedModifications;

      // Create State Machine Event
      const eventRecord = await tx.orderModificationEvent.create({
        data: {
          orderId,
          adminId,
          type: modifications.type,
          status: 'PENDING_APPROVAL',
          payload: {
            modifications,
            oldSummary,
            newSummary,
            delta,
            orderVersion: order.version
          },
          expiresAt: new Date(Date.now() + 30 * 60 * 1000)
        }
      });

      // Update Order Status to block other changes
      await tx.order.update({
        where: { id: orderId },
        data: { modificationStatus: 'PENDING_CUSTOMER' }
      });

      // 📮 [RESILIENCE-FIX] Transactional Outbox Enqueue
      const outboxService = require('./outboxService');
      const outbox = await outboxService.enqueue(eventTypes.MODIFICATION_REQUESTED, { event: eventRecord }, tx);

      return { ...eventRecord, _outboxId: outbox.id };
    });

    return event;
  }

  /**
   * 2️⃣ Step: Confirm/Apply Modification (Customer or Admin)
   */
  async applyModification(eventId, confirmedByUserId) {
    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.orderModificationEvent.findUnique({
        where: { id: eventId }
      });

      if (!event || event.status !== 'PENDING_APPROVAL') throw new Error('EVENT_NOT_ACTIVE');
      if (new Date() > event.expiresAt) {
        await tx.orderModificationEvent.update({ where: { id: eventId }, data: { status: 'EXPIRED' } });
        throw new Error('EVENT_EXPIRED');
      }

      const { delta, modifications, orderVersion } = event.payload;

      // 🛡️ Version Check (Prevent race conditions)
      const order = await tx.order.findUnique({ where: { id: event.orderId } });
      if (order.version !== orderVersion) throw new Error('CONCURRENCY_CONFLICT');

      // 💰 Handle Financial Impact (Refund to Wallet if delta is negative)
      if (delta.isRefund && order.customerId) {
        await walletService.credit(
          order.customerId,
          delta.absoluteDifference,
          'REFUND',
          order.orderNumber,
          `استرداد فرق سعر بسبب تعديل الطلب #${event.id.slice(0,8)}`,
          `mod_${event.id}`, // Idempotency
          tx
        );
      }

      // 📦 Apply Data Changes (OrderItem updates)
      if (modifications.type === 'FULL_CANCEL') {
        await tx.orderItem.updateMany({
          where: { orderId: order.id },
          data: { status: 'cancelled', rejectionReason: modifications.reason || 'FULL_CANCEL' }
        });
      } else if (modifications.type === 'REPLACE_ITEM' && modifications.replacement) {
        const { oldItemId, newItemId, quantity } = modifications.replacement;
        
        await tx.orderItem.update({
          where: { id: oldItemId },
          data: { status: 'cancelled', rejectionReason: 'REPLACED' }
        });

        const dbNewItem = await tx.item.findUnique({ where: { id: newItemId } });
        if (!dbNewItem) throw new Error('NEW_ITEM_NOT_FOUND');

        await tx.orderItem.create({
          data: {
            orderId: order.id,
            itemId: newItemId,
            itemName: dbNewItem.title,
            itemNameEn: dbNewItem.titleEn,
            quantity: quantity || 1,
            unitPrice: dbNewItem.basePrice,
            lineTotal: toNumber(dbNewItem.basePrice) * (quantity || 1),
            replacedFromId: oldItemId,
            status: 'normal'
          }
        });
      } else if (modifications.type === 'PARTIAL_CANCEL' && modifications.removeIds) {
        await tx.orderItem.updateMany({
          where: { id: { in: modifications.removeIds } },
          data: { status: 'cancelled', rejectionReason: 'PARTIAL_CANCEL' }
        });
      }
      
      // Update Event & Order
      await tx.orderModificationEvent.update({
        where: { id: eventId },
        data: { status: 'APPLIED' }
      });

      const updatedOrder = await tx.order.update({
        where: { id: event.orderId },
        data: { 
          status: modifications.type === 'FULL_CANCEL' ? 'cancelled' : order.status,
          modificationStatus: modifications.type === 'FULL_CANCEL' ? 'NONE' : 'MODIFIED',
          version: { increment: 1 },
          total: modifications.type === 'FULL_CANCEL' ? 0 : event.payload.newSummary.total,
          subtotal: modifications.type === 'FULL_CANCEL' ? 0 : event.payload.newSummary.subtotal
        }
      });

      const resultData = { success: true, order: updatedOrder, event };
      
      // 📮 [RESILIENCE-FIX] Transactional Outbox Enqueue
      const outboxService = require('./outboxService');
      const outbox = await outboxService.enqueue(eventTypes.MODIFICATION_APPLIED, resultData, tx);

      return { ...resultData, _outboxId: outbox.id };
    });

    return result;
  }
}

module.exports = new OrderModificationService();
