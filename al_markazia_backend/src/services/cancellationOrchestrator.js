/**
 * 🔒 Cancellation Orchestrator (Single Cancellation Authority)
 * Purpose: Unifies all cancellation paths (System, Admin, Auto-Timeout)
 * to ensure consistent financial, state, and audit behavior.
 */
const { mapOrderResponse } = require('../mappers/order.mapper');
const { toNumber } = require('../utils/number');
const eventTypes = require('../events/eventTypes');

class CancellationOrchestrator {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
  }

  /**
   * 🛑 Central Execution Point for all Cancellations
   */
  async execute(orderId, actor, context = {}) {
    const { reason, source, managerPassword, skipPasswordCheck = false } = context;
    
    this.logger.info(`[CancellationOrchestrator] 🛑 Processing cancellation for Order #${orderId}`, {
      source,
      actorId: actor?.id,
      actorRole: actor?.role
    });

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, cancellation: true }
    });

    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.status === 'cancelled') return mapOrderResponse(order); // Idempotent

    // 1. 🛡️ Verification (Phase 1 Secure Hardening)
    if (!skipPasswordCheck && (actor?.role === 'admin' || actor?.role?.toUpperCase() === 'BRANCH_MANAGER')) {
       await this.container.orderService._verifyManagerPassword(actor.id, managerPassword);
    }

    // 2. 🧠 Risk Assessment & Policy Routing
    const policy = await this._evaluatePolicy(order, actor, source);

    if (policy.action === 'REJECT') {
      throw new Error(`CANCELLATION_REJECTED: ${policy.reason}`);
    }

    if (policy.action === 'REQUEST_APPROVAL') {
      return await this._executeCancellationRequest(order, actor, reason, policy.level);
    }

    // 3. 💎 Atomic Execution (Final Status)
    return await this._finalizeCancellation(order, actor, reason, source);
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

  /**
   * 🛠️ Internal: Cancellation Request Workflow
   */
  async _executeCancellationRequest(order, user, reason, level) {
    const previousStatus = order.status;
    const targetStatus = level === 'HIGH' ? 'waiting_cancellation_admin' : 'waiting_cancellation';

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
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
            branchId: order.branchId, // 🛡️ [PHASE 4] Capture branch context
            requestedBy: (user?.role === 'customer' ? 0 : user?.id) || 0,
            requestedByRole: user?.role || 'customer',
            payload: { reason, level, orderNumber: order.orderNumber, total: order.total },
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
          }
        });
      }

      return updated;
    }, { timeout: 15000 });

    const EventBus = require('../events/eventBus');
    EventBus.publish({ type: 'order.cancellation_requested', payload: { order: updatedOrder, user, level } });
    return mapOrderResponse(updatedOrder);
  }

  /**
   * 💎 Internal: Perform DB updates and financial side effects
   */
  async _finalizeCancellation(order, actor, reason, source) {
    const previousStatus = order.status;
    
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: order.id, version: order.version },
        data: {
          status: 'cancelled',
          version: { increment: 1 }
        },
        include: require('../shared/prismaConstants').ORDER_INCLUDE_FULL
      });

      if (order.paymentMethod === 'wallet' && order.customerId) {
        const walletService = require('./walletService');
        await walletService.credit(
          order.customerId, 
          toNumber(order.total), 
          'REFUND', 
          order.orderNumber, 
          `Refund for ${source || 'cancellation'} #${order.orderNumber}`, 
          `cancel_${order.id}`, 
          tx
        );
      }

      await tx.orderCancellation.upsert({
        where: { orderId: order.id },
        update: { 
          status: 'approved', 
          reason: reason || `Cancelled via ${source}`, 
          cancelledBy: source || actor?.role || 'system', 
          adminName: actor?.email || 'System',
          cancelledAt: new Date(),
          refundedAmount: (order.paymentMethod === 'wallet' && order.customerId) ? order.total : 0
        },
        create: { 
          orderId: order.id, 
          reason: reason || `Cancelled via ${source}`, 
          cancelledBy: source || actor?.role || 'system', 
          previousStatus, 
          status: 'approved', 
          adminName: actor?.email || 'System',
          cancelledAt: new Date(),
          refundedAmount: (order.paymentMethod === 'wallet' && order.customerId) ? order.total : 0
        }
      });

      return updated;
    }, { timeout: 15000 });

    const EventBus = require('../events/eventBus');
    EventBus.publish({ type: 'order.cancelled', payload: { order: updatedOrder, actor, source } });

    return mapOrderResponse(updatedOrder);
  }
}

module.exports = CancellationOrchestrator;
