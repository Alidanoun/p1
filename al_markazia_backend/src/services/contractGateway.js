const orchestrator = require('./orderModificationOrchestrator');
const redis = require('../lib/redis');
const logger = require('../utils/logger');

/**
 * 🔒 System Contract Gateway (SCL Layer)
 * The Final Gatekeeper before domain execution.
 * RESPONSIBILITIES:
 * 1. Global Locking (Concurrency Control)
 * 2. Contract Enforcement (Required Fields)
 * 3. System Mode Check (Maintenance/Reconciliation)
 * 4. Idempotency Final Check
 */
class ContractGateway {

  /**
   * 🛡️ Execute with Contract Protection
   */
  async execute(orderId, action, context, actor) {
    const startTime = Date.now();
    const correlationId = require('../utils/context').getRequestId();

    // 0. 🔍 System Control Plane Guard (Active Governance)
    const controlPlane = require('./systemControlPlane');
    const health = await controlPlane.getHealthStatus();
    if (health.status === 'PROTECTED_MODE' && action !== 'PREVIEW') {
      logger.warn(`[Gateway] [${correlationId}] 🛑 SYSTEM_LOCKED. Action blocked: ${action}`);
      throw new Error(`SYSTEM_LOCKED: Protected Mode Active (${health.killSwitch.reason})`);
    }

    // 0.1 🛡️ Infrastructure Idempotency Guard
    const idempotencyService = require('./idempotencyService');
    const idempotencyKey = context.idempotencyKey;
    if (idempotencyKey) {
      const cachedResult = await idempotencyService.getResult(idempotencyKey);
      if (cachedResult) {
        logger.info(`[Gateway] ♻️ Returning cached result for Idempotency Key: ${idempotencyKey}`);
        return cachedResult;
      }
      
      const canProceed = await idempotencyService.start(idempotencyKey);
      if (!canProceed) throw new Error('IDEMPOTENCY_LOCKED: Conflict detected.');
    }

    // 1. 🔐 Acquire Global Lock (Distributed)
    // Supports both order-specific and non-order operations (batch, create)
    const lockKey = this._getLockKey(orderId, action, context, actor);
    const lockTTL = ['BATCH_ACCEPT'].includes(action) ? 60 : 30; // Batch needs longer lock
    const acquired = await redis.set(lockKey, 'locked', 'NX', 'EX', lockTTL);
    if (!acquired) {
      throw new Error('SYSTEM_BUSY:ORDER_LOCKED_BY_ANOTHER_PROCESS');
    }

    // 1.1 🛡️ [HARDENING] Circuit Breaker Guard
    const circuitBreaker = require('./circuitBreakerService');
    if (await circuitBreaker.isOpen('ORDER_OPERATIONS')) {
      await redis.del(lockKey);
      throw new Error('SYSTEM_DEGRADED: Circuit breaker open. Please try again in 30s.');
    }

    try {
      const prisma = require('../lib/prisma');
      const SecurityPolicyService = require('./securityPolicyService');

      // 1.2 🛡️ [SECURITY-GATE] Multi-Branch Isolation & Authorization
      // For non-order operations (CREATE_ORDER, BATCH_ACCEPT), authorization is delegated
      // to the operation handler since there's no existing order to check against.
      let order = null;
      if (orderId) {
        order = await prisma.order.findUnique({
          where: { id: orderId },
          select: { id: true, branchId: true }
        });

        if (!order) {
          await redis.del(lockKey);
          throw new Error('ORDER_NOT_FOUND');
        }

        // 🛡️ [INTENT-BASED ACCESS] Explicit read vs write intent
        const accessIntent = action === 'PREVIEW' ? 'read' : 'write';
        const hasAccess = await SecurityPolicyService.canAccessBranch(actor, order.branchId, accessIntent);
        
        if (!hasAccess) {
          const auditService = require('./auditService');
          await auditService.log({
            userId: actor?.id,
            userRole: actor?.role,
            action: `GATEWAY_${accessIntent.toUpperCase()}_ACCESS_DENIED`,
            entityType: 'Order',
            status: 'BLOCKED',
            severity: accessIntent === 'write' ? 'CRITICAL' : 'WARN',
            metadata: { orderId, branchId: order.branchId, gatewayAction: action, intent: accessIntent }
          });
          
          await redis.del(lockKey);
          throw new Error('UNAUTHORIZED_ORDER_ACCESS');
        }

        logger.info(`[Gateway] 🛡️ Contract validated for Order ${orderId}. Action: ${action} (Intent: ${accessIntent})`);
      } else {
        // Non-order operations: authorization handled inside operation handler
        logger.info(`[Gateway] 🛡️ Non-order operation: ${action}. Authorization delegated to handler.`);
      }

      // 2. 📝 Mandatory Contract Validation
      this._validateContract(action, context);

      // 3. 🚀 Route to Orchestrator based on action
      const orderService = require('./orderService');
      const result = await (async () => {
        switch (action) {
          case 'PREVIEW':
            return await orchestrator.preview(orderId, context.modifications, actor);
          
          case 'REQUEST':
          case 'APPLY':
          case 'CANCEL':
          case 'APPROVE_CANCEL':
          case 'REJECT_CANCEL':
          case 'UPDATE_STATUS':
          case 'UPDATE_TIMER':
          case 'UPDATE_PREP_TIME':
          case 'SUBMIT_RATING':
          case 'HANDLE_CANCEL':
          case 'AUTO_ACCEPT':
          case 'LEGACY_STATUS_UPDATE':
          case 'REQUEST_PARTIAL_CANCEL':
          case 'BATCH_ACCEPT':
          case 'APPROVE_PARTIAL_CANCEL':
          case 'REJECT_PARTIAL_CANCEL':
          case 'GET_PENDING_PARTIAL_CANCELS':
          case 'CREATE_ORDER':
            // 🛡️ Safe Write Mode Protection
            const isWriteEnabled = process.env.ENABLE_ORDER_MODIFICATION_WRITE === 'true';
            if (!isWriteEnabled) {
              throw new Error('SYSTEM_GUARD:WRITE_OPERATIONS_DISABLED_DURING_STABILIZATION');
            }
            
            if (action === 'REQUEST') {
              return await orchestrator.request(
                orderId, actor.id, context.modifications, context.idempotencyKey, actor
              );
            } else if (action === 'APPLY') {
              return await orchestrator.apply(context.eventId, actor.id, context.idempotencyKey);
            } else if (action === 'CANCEL') {
              return await orderService.cancelOrder(orderId, actor, context.reason);
            } else if (action === 'APPROVE_CANCEL') {
              return await orderService.approveCancellation(orderId, actor);
            } else if (action === 'REJECT_CANCEL') {
              return await orderService.rejectCancellation(orderId, actor, context.rejectionReason);
            } else if (action === 'UPDATE_STATUS') {
              return await orderService.updateOrderStatus(orderId, context.status, context.version, actor);
            } else if (action === 'UPDATE_TIMER') {
              return await orderService.updateOrderTimer(orderId, context.estimatedReadyAt, actor);
            } else if (action === 'UPDATE_PREP_TIME') {
              const prepResult = await orderService.updatePreparationTime(orderId, context.minutes, actor);
              return { order: prepResult, updatedAt: new Date() };
            } else if (action === 'SUBMIT_RATING') {
              return await orderService.submitOrderRating(orderId, actor, context.rating, context.comment);
            } else if (action === 'HANDLE_CANCEL') {
              // 📝 service expects (orderId, user, action, rejectionReason)
              return await orderService.handleCancellationRequest(
                orderId, actor, context.cancelAction, context.rejectionReason
              );
            } else if (action === 'AUTO_ACCEPT') {
              if (actor.role !== 'system') throw new Error('AUTO_ACCEPT_REQUIRES_SYSTEM_ACTOR');
              return await orderService.updateOrderStatus(orderId, 'preparing', null, actor);
            } else if (action === 'LEGACY_STATUS_UPDATE') {
              const metricsService = require('./metricsService');
              await metricsService.increment('legacy.performStatusUpdate');
              logger.warn('DEPRECATED_GATEWAY_ACTION: LEGACY_STATUS_UPDATE', { orderId, newStatus: context.newStatus, actorId: actor.id });
              return await orderService.updateOrderStatus(orderId, context.newStatus, null, actor);

            // ═══════════════════════════════════════════════════════
            // 🆕 Phase 2 Operations: requestPartialCancel, batchAccept, createOrder
            // ═══════════════════════════════════════════════════════

            } else if (action === 'REQUEST_PARTIAL_CANCEL') {
              return await this._executeRequestPartialCancel(orderId, context, actor, prisma);
            } else if (action === 'BATCH_ACCEPT') {
              return await this._executeBatchAccept(context, actor, prisma);
            } else if (action === 'APPROVE_PARTIAL_CANCEL') {
              return await this._executeApprovePartialCancel(orderId, context, actor, prisma);
            } else if (action === 'REJECT_PARTIAL_CANCEL') {
              return await this._executeRejectPartialCancel(orderId, context, actor, prisma);
            } else if (action === 'GET_PENDING_PARTIAL_CANCELS') {
              return await this._executeGetPendingPartialCancels(context, actor, prisma);
            } else if (action === 'CREATE_ORDER') {
              return await this._executeCreateOrder(context, actor, prisma);
            }
            break;
          
          default:
            throw new Error('INVALID_GATEWAY_ACTION');
        }
      })();

      // 4. 📮 Consistency Synchronization Layer (CSL)
      // Trigger immediate event dispatching if an outboxId is present
      if (result && result._outboxId) {
        const outboxService = require('./outboxService');
        await outboxService.immediateDispatch(result._outboxId);
      }

      // 5. 💾 Commit Idempotency & Metrics
      if (idempotencyKey) {
        await idempotencyService.commit(idempotencyKey, result);
      }
      
      const metricsService = require('./metricsService');
      const duration = Date.now() - startTime;
      await metricsService.increment(`action:${action}:success`);
      await metricsService.recordLatency(`action:${action}`, duration);

      // ✅ Record Success for auto-healing
      await circuitBreaker.recordSuccess('ORDER_OPERATIONS');

      return result;

    } catch (error) {
      const metricsService = require('./metricsService');
      await metricsService.increment(`action:${action}:failure`);

      // 🚨 Record Failure for circuit breaker
      await circuitBreaker.recordFailure('ORDER_OPERATIONS');

      // ❌ Rollback Idempotency on failure to allow retry
      if (idempotencyKey) {
        await idempotencyService.rollback(idempotencyKey);
      }
      logger.error(`[Gateway] [${correlationId}] ❌ Action ${action} failed for Order ${orderId}: ${error.message}`);
      throw error;
    } finally {
      // 5. 🔓 Release Global Lock
      await redis.del(lockKey);
      logger.info(`[Gateway] 🔓 Lock released for Order ${orderId}`);
    }
  }

  /**
   * 📝 Validate incoming payload against strict contracts
   */
  _validateContract(action, context) {
    if (action !== 'PREVIEW') {
      if (!context.idempotencyKey) throw new Error('CONTRACT_VIOLATION:MISSING_IDEMPOTENCY_KEY');
    }
    
    if (action === 'REQUEST') {
      if (context.orderVersion === undefined) throw new Error('CONTRACT_VIOLATION:MISSING_ORDER_VERSION');
    }

    if (action === 'APPLY') {
      if (!context.eventId) throw new Error('CONTRACT_VIOLATION:MISSING_EVENT_ID');
    }

    if (['APPROVE_PARTIAL_CANCEL', 'REJECT_PARTIAL_CANCEL'].includes(action)) {
      if (!context.notificationId) throw new Error('CONTRACT_VIOLATION:MISSING_NOTIFICATION_ID');
    }

    if (action === 'APPROVE_PARTIAL_CANCEL') {
      if (!context.itemsToCancel || !Array.isArray(context.itemsToCancel)) {
        throw new Error('CONTRACT_VIOLATION:MISSING_OR_INVALID_ITEMS_TO_CANCEL');
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // 🔑 Lock Key Strategy
  // ═══════════════════════════════════════════════════════

  /**
   * 🔐 Generate distributed lock key based on operation type.
   * Order-specific ops use order ID. Non-order ops use actor/context-based keys.
   */
  _getLockKey(orderId, action, context, actor) {
    if (orderId) return `lock:order:${orderId}`;

    switch (action) {
      case 'BATCH_ACCEPT':
        return `lock:batch:accept:${actor.branchId || actor.id}`;
      case 'CREATE_ORDER': {
        // Cart-hash based deduplication: same user + same items = same lock
        const crypto = require('crypto');
        const itemsStr = JSON.stringify(
          (context.cartItems || context.items || [])
            .sort((a, b) => (a.id || a.itemId || 0) - (b.id || b.itemId || 0))
            .map(i => ({ id: i.id || i.itemId, qty: i.quantity || i.qty || 1 }))
        );
        const cartHash = crypto.createHash('md5').update(itemsStr).digest('hex').substring(0, 8);
        return `lock:create:${actor?.id || 'guest'}:${cartHash}`;
      }
      default:
        return `lock:gateway:${action}:${actor?.id || 'unknown'}:${Date.now()}`;
    }
  }

  // ═══════════════════════════════════════════════════════
  // 🆕 Phase 2 Operation Handlers
  // ═══════════════════════════════════════════════════════

  /**
   * 🔸 REQUEST_PARTIAL_CANCEL — Secure partial cancellation request
   * Validates: ownership, branch isolation, item existence, refund calculation
   */
  async _executeRequestPartialCancel(orderId, context, actor, prisma) {
    const { items, reason } = context;
    const SecurityPolicyService = require('./securityPolicyService');
    const orderService = require('./orderService');

    // 1. Fetch full order with items for validation
    const fullOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true, customer: true }
    });
    if (!fullOrder) throw new Error('ORDER_NOT_FOUND');

    // 2. State validation — only allow before delivery
    const allowedStates = ['pending', 'preparing', 'ready'];
    if (!allowedStates.includes(fullOrder.status)) {
      throw new Error(`INVALID_STATE_FOR_PARTIAL_CANCEL: Order is ${fullOrder.status}`);
    }

    // 3. Ownership check for customers
    if (actor.role === 'customer') {
      const customer = await prisma.customer.findUnique({ where: { uuid: actor.id }, select: { id: true } });
      if (!customer || fullOrder.customerId !== customer.id) {
        throw new Error('NOT_YOUR_ORDER');
      }
    }

    // 4. Branch isolation for managers
    if (['manager', 'branch_manager'].includes(actor.role?.toLowerCase())) {
      const hasAccess = await SecurityPolicyService.canAccessBranch(actor, fullOrder.branchId, 'write');
      if (!hasAccess) throw new Error('BRANCH_ACCESS_DENIED');
    }

    // 5. Items validation
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('ITEMS_REQUIRED');
    }
    const orderItemIds = fullOrder.orderItems.map(i => i.id);
    const requestedIds = items.map(i => (typeof i === 'number' ? i : i.id));
    const invalidIds = requestedIds.filter(id => !orderItemIds.includes(id));
    if (invalidIds.length > 0) {
      throw new Error(`INVALID_ITEMS: ${invalidIds.join(',')}`);
    }

    // 6. Calculate refund amount
    const { toNumber } = require('../utils/number');
    const itemsToCancel = fullOrder.orderItems.filter(item => requestedIds.includes(item.id));
    const refundAmount = itemsToCancel.reduce((sum, item) => {
      return sum + toNumber(item.unitPrice) * item.quantity;
    }, 0);
    if (refundAmount <= 0) throw new Error('INVALID_REFUND_AMOUNT');

    // 7. Delegate to service with enriched metadata
    return await orderService.requestPartialCancel(orderId, items, reason, {
      refundAmount,
      requestedBy: actor.id,
      requestedAt: new Date()
    });
  }

  /**
   * 🔸 BATCH_ACCEPT — Secure batch order acceptance
   * Validates: branch access, batch size limit, delegates to transactional service
   */
  async _executeBatchAccept(context, actor, prisma) {
    const SecurityPolicyService = require('./securityPolicyService');
    const orderService = require('./orderService');

    // 1. Role validation
    const allowedRoles = ['manager', 'branch_manager', 'admin'];
    if (!allowedRoles.includes(actor.role?.toLowerCase())) {
      throw new Error('UNAUTHORIZED_BATCH_ACCEPT');
    }

    // 2. Pre-check: count pending orders
    const branchFilter = await SecurityPolicyService.getHardenedFilter(actor, 'Order');
    const pendingCount = await prisma.order.count({
      where: { status: 'pending', isDeleted: false, ...branchFilter }
    });

    if (pendingCount === 0) {
      return { success: true, accepted: 0, skipped: 0, conflicts: 0, message: 'No pending orders found' };
    }

    if (pendingCount > 50) {
      throw new Error(`BATCH_TOO_LARGE: ${pendingCount} orders found. Maximum 50 per batch.`);
    }

    // 3. Delegate to service (has transaction + optimistic locking internally)
    return await orderService.batchAcceptOrders(actor);
  }

  /**
   * 🔸 CREATE_ORDER — Secure order creation through Gateway
   * Adds: system mode check, circuit breaker, cart-hash deduplication
   */
  async _executeCreateOrder(context, actor, prisma) {
    const SecurityPolicyService = require('./securityPolicyService');
    const orderService = require('./orderService');
    const { orderData } = context;

    // 1. Validate actor has creation permission for target branch
    const targetBranchId = orderData.branchId;
    if (targetBranchId && actor && actor.role !== 'customer') {
      const allowedRoles = ['manager', 'branch_manager', 'admin'];
      if (allowedRoles.includes(actor.role?.toLowerCase())) {
        const hasAccess = await SecurityPolicyService.canAccessBranch(actor, targetBranchId, 'write');
        if (!hasAccess) throw new Error('BRANCH_ACCESS_DENIED');
      }
    }

    // 2. Delegate to service — it has its own comprehensive validation chain
    // (ghost order protection, guest type restriction, branch resolution, blacklist, etc.)
    return await orderService.createOrder(orderData, actor || null);
  }

  // ═══════════════════════════════════════════════════════
  // 🛡️ Internal Operation Handlers (Phase 2 & 3)
  // ═══════════════════════════════════════════════════════

  async _executeApprovePartialCancel(orderId, context, actor, prisma) {
    const { notificationId, itemsToCancel } = context;
    const orderService = require('./orderService');
    
    // 🛡️ Final state check
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true }
    });
    
    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (!['pending', 'preparing', 'ready'].includes(order.status)) {
      throw new Error(`INVALID_STATE: Order is already ${order.status}`);
    }

    // 🛡️ Validate that items to cancel exist in the order
    const currentItemIds = order.orderItems.map(i => i.id);
    const validCancelIds = itemsToCancel.filter(id => currentItemIds.includes(id));
    
    if (validCancelIds.length === 0) {
      throw new Error('INVALID_ITEMS: No valid items found to cancel');
    }

    // 🚀 Execute Atomic Adjustment
    const result = await orderService.applyPartialCancellation(orderId, validCancelIds, actor, notificationId);
    
    logger.info(`[Gateway] ✅ Partial cancel approved for order ${orderId} by ${actor.id}`);
    return result;
  }

  async _executeRejectPartialCancel(orderId, context, actor, prisma) {
    const { notificationId, reason } = context;
    const orderService = require('./orderService');
    
    // Simply mark notification as handled and notify user
    await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, metadata: JSON.stringify({ ...JSON.parse(context.oldMetadata || '{}'), rejectionReason: reason, rejectedAt: new Date() }) }
    });

    // Notify Customer
    const notificationService = require('./notificationService');
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    
    await notificationService.sendToUser(order.customerId, {
      title: 'تحديث بخصوص طلب الإلغاء الجزئي ❌',
      message: `عذراً، تم رفض طلب تعديل طلبك #${order.orderNumber}. السبب: ${reason || 'غير محدد'}`,
      type: 'partial_cancel_rejected',
      orderId: order.id
    });

    return { success: true, status: 'REJECTED' };
  }

  async _executeGetPendingPartialCancels(context, actor, prisma) {
    const SecurityPolicyService = require('./securityPolicyService');
    const branchFilter = await SecurityPolicyService.getHardenedFilter(actor, 'Order');
    
    // Fetch notifications of type 'partial_cancel_requested' that haven't been resolved
    // We check for isRead: false as a proxy for 'pending' in this system
    return await prisma.notification.findMany({
      where: {
        type: 'partial_cancel_requested',
        isRead: false,
        order: {
          branchId: branchFilter.branchId // Apply branch isolation
        }
      },
      include: {
        order: {
          select: {
            orderNumber: true,
            customerName: true,
            totalAmount: true,
            status: true,
            createdAt: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }
}

module.exports = new ContractGateway();
