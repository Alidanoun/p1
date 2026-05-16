/**
 * 🔒 Cancellation Orchestrator (The Final Authority)
 * Phase 1: Core Consolidation & Correctness
 */
const { mapOrderResponse } = require('../mappers/order.mapper');
const { toNumber } = require('../utils/number');
const eventTypes = require('../events/eventTypes');
const AuditLogger = require('../utils/auditLogger');

class CancellationOrchestrator {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
  }

  /**
   * 🛑 Central Execution Point for all Cancellations
   * Enforces Rule #1: Single Source of Truth
   */
  async execute(orderId, actor, context = {}) {
    const { reason, source, managerPassword, skipPasswordCheck = false } = context;
    const idempotencyKey = `cancellation:${orderId}`; // Directive #8

    this.logger.info(`[Cancellation] 🛑 Processing orchestrated cancellation for Order #${orderId}`, {
      source,
      actorId: actor?.id,
      idempotencyKey
    });

    // 🛡️ [SECURITY] Global Idempotency Lock
    const check = await this.container.idempotencyService.start(idempotencyKey, 'CANCEL_ORDER', context, actor);
    if (check.status === 'COMPLETED') return check.response;

    try {
      // 1. 🔍 Initial State Fetch (Outside Tx for performance, but we lock inside)
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { cancellation: true }
      });

      if (!order) throw new Error('ORDER_NOT_FOUND');
      if (order.status === 'cancelled') {
        await this.container.idempotencyService.commit(idempotencyKey, mapOrderResponse(order));
        return mapOrderResponse(order);
      }

      // 2. 🧠 Policy Evaluation (Permission & Rule Engine)
      const policy = await this._evaluatePolicy(order, actor, source);

      if (policy.action === 'REJECT') {
        throw new Error(`CANCELLATION_REJECTED: ${policy.reason}`);
      }

      // 🔐 [SECURITY] Verification (Manager Password)
      if (!skipPasswordCheck && (actor?.role === 'admin' || actor?.role?.toUpperCase() === 'BRANCH_MANAGER')) {
        await this.container.orderService._verifyManagerPassword(actor.id, managerPassword);
      }

      if (policy.action === 'REQUEST_APPROVAL') {
        const requestResult = await this._executeCancellationRequest(order, actor, reason, policy.level);
        await this.container.idempotencyService.commit(idempotencyKey, requestResult);
        return requestResult;
      }

      // 3. 💎 [ATOMICITY RULE] Primary Aggregate State Change (Directive #1 & #8)
      const result = await this.prisma.$transaction(async (tx) => {
        // --- PHASE 1: Aggregate State Lock & Guard ---
        const lockedOrders = await tx.$queryRaw`SELECT * FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
        const lockedOrder = lockedOrders[0];

        if (!lockedOrder || lockedOrder.status === 'cancelled') {
          return { updated: order, outboxIds: [] };
        }

        // B. 📝 Update Order Aggregate
        const updated = await tx.order.update({
          where: { id: order.id, version: order.version },
          data: {
            status: 'cancelled',
            version: { increment: 1 },
            eventSequence: { increment: 1 }
          },
          include: require('../shared/prismaConstants').ORDER_INCLUDE_FULL
        });

        // C. 📝 OrderCancellation Record
        await tx.orderCancellation.upsert({
          where: { orderId: order.id },
          update: { 
            status: 'approved', 
            reason: reason || `Cancelled via ${source}`, 
            cancelledBy: source || actor?.role || 'system', 
            adminName: actor?.email || 'System',
            cancelledAt: new Date()
          },
          create: { 
            orderId: order.id, 
            reason: reason || `Cancelled via ${source}`, 
            cancelledBy: source || actor?.role || 'system', 
            previousStatus: order.status, 
            status: 'approved', 
            adminName: actor?.email || 'System',
            cancelledAt: new Date()
          }
        });

        // --- PHASE 2: Saga Initiation (Outbox Pattern) ---
        // We start the cancellation saga. Each consumer will trigger the next step.
        // Sequence: Financial -> Inventory -> Logistics -> Finalized
        
        const sagaStartEvent = await this.container.outboxService.enqueue(tx, {
          type: eventTypes.ORDER_FINANCIAL_ROLLBACK,
          aggregateId: order.id,
          aggregateType: 'Order',
          payload: { 
            orderId: order.id,
            total: updated.total,
            customerId: updated.customerId,
            paymentMethod: updated.paymentMethod,
            pointsDiscount: updated.discount,
            pointsAwarded: updated.pointsAwarded,
            branchId: updated.branchId,
            items: updated.orderItems.map(i => ({ itemId: i.itemId, quantity: i.quantity })),
            actor,
            source
          }
        });

        // 📝 Audit logging inside transaction
        await this._logAtomicAudit(tx, order.id, actor, { 
          action: 'CANCELLATION_INITIATED', 
          details: { source, reason, previousStatus: lockedOrder.status, sagaId: sagaStartEvent.id } 
        });

        return { updated, outboxId: sagaStartEvent.id };
      }, { timeout: 10000 });

      // 4. 🚀 Post-Commit Immediate Dispatch
      if (result.outboxId) {
        this.container.outboxService.immediateDispatch(result.outboxId).catch(() => {});
      }

      const finalizedOrder = mapOrderResponse(result.updated);
      await this.container.idempotencyService.commit(idempotencyKey, finalizedOrder);
      
      return finalizedOrder;

    } catch (error) {
      this.logger.error(`[Cancellation] ❌ Orchestration failure for #${orderId}`, { error: error.message });
      await this.container.idempotencyService.rollback(idempotencyKey);
      throw error;
    }
  }

  /**
   * 🛡️ Financial Rollback Engine (Atomically bounded to TX)
   * Directive #3: Loyalty via Ledger Only
   */
  async _applyFinancialRollback(tx, order, actor, source) {
    const deltas = {
      refundAmount: 0,
      pointsClawback: 0,
      pointsRefund: 0
    };

    // 1. 💳 Wallet Refund
    if (order.paymentMethod === 'wallet' && order.customerId) {
      deltas.refundAmount = toNumber(order.total);
      await this.container.walletService.credit(
        order.customerId,
        deltas.refundAmount,
        'REFUND',
        order.orderNumber,
        `Refund for cancellation #${order.orderNumber}`,
        `cancel_refund:${order.id}`,
        tx
      );
      await this._logAtomicAudit(tx, order.id, actor, { action: 'REFUND_APPLIED', details: { amount: deltas.refundAmount, method: 'wallet' } });
    }

    // 2. 🎁 Loyalty Reversal (Clawback awarded points)
    if (order.customerId) {
      const awarded = await tx.awardedLoyaltyPoints.findUnique({ where: { orderId: order.id } });
      if (awarded && awarded.points > 0) {
        deltas.pointsClawback = awarded.points;
        await this.container.loyaltyLedgerService.debit(
          order.customerId,
          awarded.points,
          'CLAWBACK',
          order.id.toString(),
          `Clawback for cancelled order #${order.orderNumber}`,
          `cancel_clawback:${order.id}`,
          {}, // metadata
          tx
        );
        await tx.awardedLoyaltyPoints.delete({ where: { orderId: order.id } });
        await this._logAtomicAudit(tx, order.id, actor, { action: 'LOYALTY_CLAWBACK', details: { points: deltas.pointsClawback } });
      }

      // 3. 🎁 Redemption Refund (Credit back spent points)
      // Check if order had a discount that should be refunded as points
      const redemption = await tx.loyaltyLedger.findFirst({
        where: { customerId: order.customerId, category: 'REDEMPTION', referenceId: String(order.id) }
      });
      if (redemption) {
        deltas.pointsRefund = Math.abs(redemption.points);
        await this.container.loyaltyLedgerService.credit(
          order.customerId,
          deltas.pointsRefund,
          'REDEMPTION_REFUND',
          order.id.toString(),
          `Points refund for cancelled order #${order.orderNumber}`,
          `cancel_redeem_refund:${order.id}`,
          {}, // metadata
          tx
        );
        await this._logAtomicAudit(tx, order.id, actor, { action: 'LOYALTY_REFUND', details: { points: deltas.pointsRefund } });
      }
    }

    return deltas;
  }

  async _logAtomicAudit(tx, orderId, actor, { action, details }) {
    await AuditLogger.logOrderChange(tx, {
      orderId,
      eventType: 'CANCELLATION_WORKFLOW',
      eventAction: action,
      changedBy: actor?.email || actor?.id || 'system',
      changedByRole: actor?.role || 'system',
      newData: details
    });
  }

  /**
   * 🧠 Evaluate cancellation policy
   */
  async _evaluatePolicy(order, actor, source) {
    if (source === 'SYSTEM_TIMEOUT' || source === 'SYSTEM_CANCEL' || source === 'ADMIN_APPROVAL') {
      return { action: 'EXECUTE', level: 'LOW' };
    }

    const isAdmin = actor?.role === 'admin';
    const isManager = actor?.role?.toUpperCase() === 'BRANCH_MANAGER';
    
    if (isAdmin) return { action: 'EXECUTE', level: 'HIGH' };

    const config = await this.container.configService.getFullConfig();
    const timeDiff = (Date.now() - new Date(order.createdAt).getTime()) / 60000;
    const freeCancelWindow = config.business.freeCancelWindowMinutes;

    let level = 'LOW';
    if (order.status === 'pending' && timeDiff < freeCancelWindow) {
      level = 'LOW';
    } else if (order.status === 'preparing' || (order.status === 'pending' && timeDiff >= freeCancelWindow)) {
      level = 'MEDIUM';
    } else {
      level = 'HIGH';
    }

    if (toNumber(order.total) > 50) level = 'HIGH';

    if (isManager && (level === 'LOW' || level === 'MEDIUM')) return { action: 'EXECUTE', level };
    if (actor?.role === 'customer' && level === 'LOW') return { action: 'EXECUTE', level };

    return { action: 'REQUEST_APPROVAL', level };
  }

  async _executeCancellationRequest(order, user, reason, level) {
    const previousStatus = order.status;
    const targetStatus = level === 'HIGH' ? 'waiting_cancellation_admin' : 'waiting_cancellation';

    return await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: order.id, version: order.version },
        data: { status: targetStatus, version: { increment: 1 } },
        include: require('../shared/prismaConstants').ORDER_INCLUDE_FULL
      });

      await tx.orderCancellation.upsert({
        where: { orderId: order.id },
        update: { status: 'pending', reason: reason || 'Requested', cancelledBy: user?.role || 'customer' },
        create: { orderId: order.id, reason: reason || 'Requested', cancelledBy: user?.role || 'customer', previousStatus, status: 'pending' }
      });

      if (level === 'HIGH') {
        await tx.financialApproval.create({
          data: {
            operationType: 'CANCELLATION',
            entityId: order.id.toString(),
            branchId: order.branchId,
            requestedBy: (user?.role === 'customer' ? 0 : user?.id) || 0,
            requestedByRole: user?.role || 'customer',
            payload: { reason, level, orderNumber: order.orderNumber, total: order.total },
            amount: toNumber(order.total),
            riskLevel: toNumber(order.total) > 100 ? 'HIGH' : 'MEDIUM',
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
          }
        });
      }

      await this.container.outboxService.enqueue(tx, {
        type: 'order.cancellation_requested',
        aggregateId: order.id,
        aggregateType: 'Order',
        payload: { order: mapOrderResponse(updated), user, level },
        version: updated.version,
        eventSequence: updated.eventSequence || 1
      });

      await this._logAtomicAudit(tx, order.id, user, { action: 'CANCELLATION_INITIATED', details: { level, targetStatus } });

      return mapOrderResponse(updated);
    });
  }
}

module.exports = CancellationOrchestrator;
