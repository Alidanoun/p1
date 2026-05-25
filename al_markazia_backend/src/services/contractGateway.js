/**
 * 🔒 System Contract Gateway (SCL Layer)
 */
class ContractGateway {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.redis = container.redis;
    this.logger = container.logger;
  }

  async execute(orderId, action, context, actor) {
    const startTime = Date.now();
    // 🔗 [PHASE 2] Enforcement: Automatic Correlation ID from context
    const correlationId = require('../utils/context').getCorrelationId() || 'unknown';

    const health = await this.container.systemControlPlane.getHealthStatus();
    if (health.status === 'PROTECTED_MODE' && action !== 'PREVIEW') {
      this.logger.warn(`[Gateway] [${correlationId}] 🛑 SYSTEM_LOCKED. Action blocked: ${action}`);
      throw new Error(`SYSTEM_LOCKED: Protected Mode Active (${health.killSwitch.reason})`);
    }

    const idempotencyKey = context.idempotencyKey;
    if (idempotencyKey) {
      const check = await this.container.idempotencyService.start(idempotencyKey, action, context, actor);
      if (check.status === 'COMPLETED') {
         this.logger.info(`[Gateway] [${correlationId}] ♻️ Returning cached result for key: ${idempotencyKey}`);
         return check.response;
      }
    }

    const lockKey = this._getLockKey(orderId, action, context, actor);
    const acquired = await this.redis.set(lockKey, 'locked', 'NX', 'EX', 30);
    if (!acquired) throw new Error('SYSTEM_BUSY');

    if (await this.container.circuitBreakerService.isOpen('ORDER_OPERATIONS')) {
      await this.redis.del(lockKey);
      throw new Error('SYSTEM_DEGRADED');
    }

    try {
      if (orderId) {
        const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true, branchId: true } });
        if (!order) { await this.redis.del(lockKey); throw new Error('ORDER_NOT_FOUND'); }

        const accessIntent = action === 'PREVIEW' ? 'read' : 'write';
        const hasAccess = await this.container.securityPolicyService.canAccessBranch(actor, order.branchId, accessIntent);
        if (!hasAccess) {
          await this.container.auditService.log({ userId: actor?.id, userRole: actor?.role, action: 'GATEWAY_DENIED', status: 'BLOCKED' });
          await this.redis.del(lockKey);
          throw new Error('UNAUTHORIZED');
        }
      }

      // 🛡️ [PHASE 2] Enforcement: DTO Contract & State Machine Validation
      await this._validateContract(action, context, orderId, actor);

      // We use require for orchestrator for now if it's not in container
      const orchestrator = require('./orderModificationOrchestrator');
      const result = await (async () => {
        switch (action) {
          case 'PREVIEW': return await orchestrator.preview(orderId, context.modifications, actor);
          case 'CANCEL': return await this.container.orderLifecycleOrchestrator.cancel(orderId, actor, { ...context, source: 'ADMIN_CANCEL' });
          case 'SYSTEM_CANCEL': return await this.container.cancellationOrchestrator.execute(orderId, actor, { ...context, source: 'SYSTEM_CANCEL', skipPasswordCheck: true });
          case 'UPDATE_STATUS': return await this.container.orderLifecycleOrchestrator.transitionStatus(orderId, context.status, actor, context);
          case 'CREATE_ORDER': return await this.container.orderService.createOrder(context.orderData, actor);
          case 'REQUEST_PARTIAL_CANCEL': return await this.container.orderService.requestPartialCancel(orderId, context.items, context.reason, actor, context);
          case 'APPROVE_PARTIAL_CANCEL': return await this.container.orderService.applyPartialCancellation(orderId, context.itemsToCancel, actor, context.notificationId, context.managerPassword);
          case 'SUGGEST_REPLACEMENT': return await this.container.orderService.suggestReplacement(orderId, context.itemId, context.suggestedReplacementItemId, actor);
          case 'RESPOND_REPLACEMENT': return await this.container.orderService.respondReplacement(orderId, context.itemId, context.accept, context.preference, actor);
          case 'REQUEST_COUPON': return await this.container.orderService.requestCouponForCancelledItem(orderId, context.itemId, actor);
          default:
            // Fallback for non-refactored paths
            return await this._legacyExecute(orderId, action, context, actor);
        }
      })();

      if (result && result._outboxId) await this.container.outboxService.immediateDispatch(result._outboxId);
      if (idempotencyKey) await this.container.idempotencyService.commit(idempotencyKey, result);
      
      await this.container.circuitBreakerService.recordSuccess('ORDER_OPERATIONS');
      return result;
    } catch (error) {
      // 🛡️ Only infrastructure/unexpected errors trip the circuit breaker, not business errors
      const businessErrors = [
        'ITEM_NOT_FOUND', 'ITEM_NOT_IN_BRANCH', 'ITEM_UNAVAILABLE',
        'INSUFFICIENT_STOCK', 'EMPTY_ORDER_NOT_ALLOWED', 'INVALID_TRANSITION',
        'BRANCH_ACCESS_DENIED', 'ORDER_FORBIDDEN', 'AUTH_REQUIRED',
        'CONTRACT_VIOLATION', 'MISSING_IDEMPOTENCY_KEY', 'IDEMPOTENCY_MISMATCH',
        'BRANCH_ISOLATION_VIOLATION', 'CONCURRENCY_CONFLICT',
        'BRANCH_NOT_OPERATIONAL', 'ORDER_NOT_FOUND', 'UNAUTHORIZED', 'SYSTEM_BUSY'
      ];
      
      const isBusinessError = businessErrors.some(be => error.message?.includes(be));
      
      if (!isBusinessError) {
        await this.container.circuitBreakerService.recordFailure('ORDER_OPERATIONS');
      }
      
      if (idempotencyKey) await this.container.idempotencyService.rollback(idempotencyKey);
      throw error;
    } finally {
      await this.redis.del(lockKey);
    }
  }

  async _legacyExecute(orderId, action, context, actor) {
    // This is a temporary bridge for actions not yet moved to the switch
    // It basically does what the old code did but using container services
    const orderService = this.container.orderService;
    const orchestrator = require('./orderModificationOrchestrator');

    if (action === 'REQUEST') return await orchestrator.request(orderId, actor.id, context.modifications, context.idempotencyKey, actor);
    if (action === 'APPLY') return await orchestrator.apply(context.eventId, actor.id, context.idempotencyKey);
    if (action === 'APPROVE_CANCEL') return await this.container.orderLifecycleOrchestrator.cancel(orderId, actor, { ...context, source: 'ADMIN_APPROVAL' });
    if (action === 'REJECT_CANCEL') return await orderService.rejectCancellation(orderId, actor, context.rejectionReason);
    if (action === 'UPDATE_TIMER') return await orderService.updateOrderTimer(orderId, context.estimatedReadyAt, actor);
    if (action === 'UPDATE_PREP_TIME') return await orderService.updatePreparationTime(orderId, context.minutes, actor);
    if (action === 'SUBMIT_RATING') return await orderService.submitOrderRating(orderId, actor, context.rating, context.comment);
    if (action === 'BATCH_ACCEPT') return await orderService.batchAcceptOrders(actor);
    
    throw new Error(`UNSUPPORTED_GATEWAY_ACTION: ${action}`);
  }

  async _validateContract(action, context, orderId = null, actor = null) {
    // 1. Mandatory Idempotency for Writes
    if (action !== 'PREVIEW' && !context.idempotencyKey) {
      throw new Error('MISSING_IDEMPOTENCY_KEY: All write operations must provide a unique key.');
    }

    const { v1 } = require('../contracts/order.contract.v1');

    // 2. Schema Validation (DTO Enforcement)
    try {
      if (action === 'CREATE_ORDER') {
        v1.CreateOrderSchema.parse(context.orderData);
      }
      if (action === 'UPDATE_STATUS') {
        v1.TransitionStatusSchema.parse({ ...context, orderId });
      }
      if (action === 'CANCEL') {
        v1.CancellationRequestSchema.parse({ ...context, orderId });
      }
    } catch (err) {
      this.logger.error('[Gateway] Contract Violation', { action, errors: err.errors });
      throw new Error(`CONTRACT_VIOLATION: ${err.errors?.[0]?.message || 'Invalid input schema'}`);
    }

    // 3. State Machine & Branch Isolation Enforcement
    if (orderId) {
      const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true, branchId: true } });
      if (order) {
        // A. State Check
        if (action === 'UPDATE_STATUS') {
           this.container.orderStateMachine.validate(order.status, context.status, actor);
        }
        
        // B. [PHASE 3] Branch Consistency Check (Zero Trust)
        const contextBranchId = require('../utils/context').getBranchId();
        if (contextBranchId && order.branchId !== contextBranchId) {
          this.logger.error('[Gateway] Branch Isolation Violation', { orderId, orderBranch: order.branchId, contextBranch: contextBranchId });
          throw new Error('BRANCH_ISOLATION_VIOLATION: Order does not belong to the authorized branch context.');
        }
      }
    }
  }

  _getLockKey(orderId, action, context, actor) {
    const actorId = actor?.id || 'system';
    if (orderId) return `lock:order:${orderId}:${actorId}`;
    return `lock:gateway:${action}:${actorId}`;
  }
}

// --- 🛡️ Backward Compatibility ---
const getContainer = () => require('../lib/container');
const proxy = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'ContractGateway') return ContractGateway;
    const service = getContainer().contractGateway;
    const val = service[prop];
    return typeof val === 'function' ? val.bind(service) : val;
  }
});

module.exports = proxy;
module.exports.ContractGateway = ContractGateway;
