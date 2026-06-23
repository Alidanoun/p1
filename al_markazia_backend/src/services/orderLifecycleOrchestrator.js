const { mapOrderResponse } = require('../mappers/order.mapper');
const { toNumber, toMoney } = require('../utils/number');
const eventTypes = require('../events/eventTypes');

/**
 * 👑 OrderLifecycleOrchestrator (The Final Authority)
 * Phase 5: Architectural Consolidation
 * 
 * Purpose: Unifies all order lifecycle events into a single, canonical pipeline.
 * Ensures that every update follows the exact same sequence:
 * Transaction -> Audit -> Analytics -> Socket -> Sync.
 */
class OrderLifecycleOrchestrator {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
  }

  /**
   * 🔄 Unified Status Transition
   */
  async transitionStatus(orderId, newStatus, actor, context = {}) {
    const { version, reason, managerPassword } = context;
    
    this.logger.info(`[Lifecycle] 🔄 Transitioning Order #${orderId} to ${newStatus}`, { actorId: actor?.id });

    // 1. Fetch Latest State
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, orderItems: true }
    });

    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.status === newStatus) return mapOrderResponse(order);

    // 2. 🛡️ [PHASE 2] Enforcement: State Machine & Permission Check
    this.container.orderStateMachine.validate(order.status, newStatus, actor);

    // 3. 💎 Atomic Pipeline (DB Transaction)
    const result = await this.prisma.$transaction(async (tx) => {
      // A. Update Status & Version
      const updated = await tx.order.update({
        where: { id: order.id, version: order.version },
        data: { 
          status: newStatus, 
          version: { increment: 1 }, 
          eventSequence: { increment: 1 } 
        },
        include: require('../shared/prismaConstants').ORDER_INCLUDE_FULL
      });

      // B. 🎁 Status-Specific Logic (Hooks)
      if (newStatus === 'delivered') {
        const pointsEarned = await this.container.loyaltyService.calculatePointsForOrder(updated);
        if (pointsEarned > 0) {
          await this.container.outboxService.enqueue(tx, {
            type: 'loyalty.order_award',
            aggregateId: updated.id,
            aggregateType: 'Order',
            payload: {
              orderId: updated.id,
              orderNumber: updated.orderNumber,
              customerId: updated.customerId,
              points: pointsEarned
            }
          });
          this.logger.debug(`[Lifecycle] Enqueued loyalty reward for order #${updated.id} (${pointsEarned} points)`);
        }

        // 🎟️ Referral System Hook: Award points if this is the customer's first delivered order
        if (updated.customerId) {
          const dbCustomer = await tx.customer.findUnique({
            where: { id: updated.customerId },
            select: { referredById: true }
          });
          
          if (dbCustomer && dbCustomer.referredById) {
            const previousDeliveredOrdersCount = await tx.order.count({
              where: {
                customerId: updated.customerId,
                status: 'delivered',
                id: { not: updated.id }
              }
            });
            
            if (previousDeliveredOrdersCount === 0) {
              const referralPoints = await this.container.loyaltyService.calculateEngagementPoints('REFERRAL');
              await this.container.outboxService.enqueue(tx, {
                type: 'loyalty.referral_award',
                aggregateId: String(dbCustomer.referredById),
                aggregateType: 'Customer',
                payload: {
                  referredCustomerId: updated.customerId,
                  referrerCustomerId: dbCustomer.referredById,
                  points: referralPoints,
                  orderId: updated.id
                }
              });
              this.logger.info(`[Lifecycle] Enqueued referral reward for referrer Customer #${dbCustomer.referredById} due to Customer #${updated.customerId} first order`);
            }
          }
        }
      }

      // C. 📮 Canonical Audit & Outbox
      const outbox = await this.container.outboxService.enqueue(tx, {
        type: eventTypes.ORDER_STATUS_CHANGED,
        aggregateId: order.id,
        aggregateType: 'Order',
        payload: {
          previousStatus: order.status,
          newStatus,
          order: mapOrderResponse(updated)
        },
        eventSequence: updated.eventSequence
      });

      return { updated, outboxId: outbox.id };
    }, { timeout: 15000 });

    // 4. 🚀 Post-Transaction Synchronization (Async)
    await this._triggerSync(result.updated, result.outboxId, { 
       type: 'ORDER_STATUS_CHANGE', 
       previousStatus: order.status, 
       newStatus 
    });

    return mapOrderResponse(result.updated);
  }

  /**
   * 🛑 Unified Cancellation (Consolidates CancellationOrchestrator)
   */
  async cancel(orderId, actor, context = {}) {
     // Delegate to existing orchestrator for now, but following the same contract
     // In a final consolidation, the logic from CancellationOrchestrator moves here.
     return await this.container.cancellationOrchestrator.execute(orderId, actor, context);
  }

  /**
   * 💰 Unified Refund/Approval
   */
  async processApproval(approvalId, actor, action, reason = '') {
    const approval = await this.prisma.financialApproval.findUnique({
      where: { id: approvalId }
    });

    if (!approval) throw new Error('APPROVAL_NOT_FOUND');
    
    // Canonical Logic: Route based on operation type
    if (action === 'approve') {
       return await this.container.financialApprovalService.approve(approvalId, actor);
    } else {
       return await this.container.financialApprovalService.reject(approvalId, actor, reason);
    }
  }

  /**
   * ⚡ Canonical Sync Pipeline
   */
  async _triggerSync(order, outboxId, analyticsPayload) {
    try {
      // 1. Dispatch Outbox (Socket/Events)
      if (outboxId) {
        await this.container.outboxService.immediateDispatch(outboxId);
      }

      // 2. Update Analytics
      this.container.analyticsService.updateCacheIncrementally({
        ...analyticsPayload,
        amount: toNumber(order.total),
        orderNumber: order.orderNumber,
        branchId: order.branchId
      });

      // 3. Update Live Cache
      await this.container.liveCacheService.cacheOrder(order);

      // 4. Bump Branch Version (Client Sync)
      await this.container.orderService.bumpBranchVersion(order.branchId);

    } catch (err) {
      this.logger.error('[Lifecycle] Sync Pipeline Failure', { orderId: order.id, error: err.message });
    }
  }
}

module.exports = OrderLifecycleOrchestrator;
