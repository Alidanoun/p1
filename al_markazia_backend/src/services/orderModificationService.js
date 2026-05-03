const prisma = require('../lib/prisma');
const pricingService = require('./pricingService');
const walletService = require('./walletService');
const eventBus = require('../events/eventBus');
const eventTypes = require('../events/eventTypes');
const logger = require('../utils/logger');
const financialGuard = require('../utils/financialGuard');
const { toNumber } = require('../utils/number');
const accountingService = require('./accountingService');

/**
 * 🔄 Order Modification State Machine (Financial-Hardened)
 */
class OrderModificationService {

  /**
   * 1️⃣ Step: Request Modification
   */
  async requestModification(orderId, user, enrichedModifications) {
    // 🛡️ [PHASE 4] Permission Guard
    financialGuard.assertPermission(user, 'MODIFY_CONFIRMED_ORDER');

    const event = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new Error('ORDER_NOT_FOUND');

      const { oldSummary, newSummary, delta, ...modifications } = enrichedModifications;

      // 🛡️ [PHASE 4] Check if Two-Step Approval is needed
      const needsApproval = financialGuard.requiresApproval(user, 'MODIFY_CONFIRMED_ORDER');
      const initialStatus = needsApproval ? 'PENDING_APPROVAL' : 'READY_TO_APPLY';

      // Create Modification Event
      const eventRecord = await tx.orderModificationEvent.create({
        data: {
          orderId,
          adminId: user.id,
          type: modifications.type,
          status: initialStatus,
          payload: {
            modifications,
            oldSummary,
            newSummary,
            delta,
            orderVersion: order.version
          },
          expiresAt: new Date(Date.now() + 60 * 60 * 1000) // 1 Hour
        }
      });

      if (needsApproval) {
        await tx.financialApproval.create({
          data: {
            operationType: 'PRICE_OVERRIDE',
            entityId: eventRecord.id,
            requestedBy: user.id,
            requestedByRole: user.role,
            payload: { delta, orderId },
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 Hours
          }
        });

        // 🚨 [HARDENING] Raise CRITICAL alert if refund > 100 JOD
        if (delta.isRefund && toNumber(delta.absoluteDifference) > 100) {
          await tx.notification.create({
            data: {
              title: '🚨 تنبيه: استرداد مالي ضخم!',
              message: `طلب استرداد بقيمة ${delta.absoluteDifference} د.أ للطلب #${order.orderNumber}. يتطلب موافقة فورية.`,
              severity: 'CRITICAL',
              alertType: 'FINANCIAL_HIGH_RISK',
              orderId: order.id,
              targetRoute: '/operations'
            }
          });
        }
      }

      await tx.order.update({
        where: { id: orderId },
        data: { modificationStatus: 'PENDING_CUSTOMER' }
      });

      return eventRecord;
    });

    return event;
  }

  /**
   * 2️⃣ Step: Confirm/Apply Modification
   */
  async applyModification(eventId, user) {
    // 🛡️ [PHASE 4] Permission Guard
    financialGuard.assertPermission(user, 'MODIFY_CONFIRMED_ORDER');

    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.orderModificationEvent.findUnique({ where: { id: eventId } });
      if (!event || event.status === 'APPLIED') throw new Error('EVENT_NOT_ACTIVE');
      
      // Check for Approval if required
      if (event.status === 'PENDING_APPROVAL') {
        const approval = await tx.financialApproval.findFirst({
          where: { entityId: eventId, status: 'APPROVED' }
        });
        if (!approval) throw new Error('MISSING_FINANCIAL_APPROVAL');
      }

      const { delta, modifications, orderVersion, oldSummary, newSummary } = event.payload;

      // 🛡️ [PHASE 5] Optimistic Locking
      const order = await tx.order.findUnique({ where: { id: event.orderId } });
      if (order.version !== orderVersion) throw new Error('CONCURRENCY_CONFLICT');

      // 💰 [PHASE 5] Ledger Entry (Before update to lock state)
      const ledgerType = delta.isRefund ? 'DEBIT' : 'CREDIT';
      const ledgerAmount = Math.abs(toNumber(delta.absoluteDifference));
      
      if (ledgerAmount > 0) {
        await tx.financialLedger.create({
          data: {
            orderId: order.id,
            branchId: order.branchId,
            customerId: order.customerId,
            type: ledgerType,
            category: 'ADJUSTMENT',
            amount: ledgerAmount,
            balanceBefore: order.total,
            balanceAfter: newSummary.total,
            idempotencyKey: `mod_${event.id}`,
            referenceId: order.orderNumber,
            description: `تعديل طلب: ${modifications.type}`,
            metadata: { eventId: event.id, delta }
          }
        });
      }

      // 💰 Wallet Impact
      if (delta.isRefund && order.customerId) {
        await walletService.credit(
          order.customerId,
          delta.absoluteDifference,
          'REFUND',
          order.orderNumber,
          `استرداد فرق سعر للطلب #${order.orderNumber}`,
          `wallet_mod_${event.id}`,
          tx
        );
      }

      // 📦 Apply OrderItem changes
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
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            itemId: newItemId,
            itemName: dbNewItem.title,
            quantity: quantity || 1,
            unitPrice: dbNewItem.basePrice,
            lineTotal: toNumber(dbNewItem.basePrice) * (quantity || 1),
            replacedFromId: oldItemId,
            status: 'normal'
          }
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
          total: modifications.type === 'FULL_CANCEL' ? 0 : newSummary.total,
          subtotal: modifications.type === 'FULL_CANCEL' ? 0 : newSummary.subtotal
        }
      });

      // 🧾 [PHASE 2] Audit Trail
      const { logFinancialEvent } = require('../utils/financialLogger');
      logFinancialEvent(accountingService.createAuditLog(
        'ORDER_MODIFIED',
        order.id,
        oldSummary.total,
        newSummary.total,
        user.id,
        { orderNumber: order.orderNumber, modType: modifications.type }
      ));

      return { success: true, order: updatedOrder };
    });

    return result;
  }
}

module.exports = new OrderModificationService();
