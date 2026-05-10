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
      include: { customer: true, items: true }
    });

    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.status === newStatus) return mapOrderResponse(order);

    // 2. 🛡️ Canonical Guard: State Machine & Permission Check
    const { validateTransition } = require('../utils/stateMachine');
    validateTransition(order.status, newStatus, orderId, this.container.auditService, actor);

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
      let pointsEarned = 0;
      if (newStatus === 'delivered') {
        pointsEarned = await this.container.loyaltyService.awardPointsForOrder(updated, tx);
      }

      // C. 📮 Canonical Audit & Outbox
      const outbox = await this.container.outboxService.enqueue(eventTypes.ORDER_STATUS_CHANGED, {
        previousStatus: order.status,
        newStatus,
        order: { ...mapOrderResponse(updated), pointsEarned }
      }, tx);

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
