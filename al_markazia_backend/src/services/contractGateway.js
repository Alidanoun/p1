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
    const correlationId = require('../utils/context').getRequestId();

    const health = await this.container.systemControlPlane.getHealthStatus();
    if (health.status === 'PROTECTED_MODE' && action !== 'PREVIEW') {
      this.logger.warn(`[Gateway] [${correlationId}] 🛑 SYSTEM_LOCKED. Action blocked: ${action}`);
      throw new Error(`SYSTEM_LOCKED: Protected Mode Active (${health.killSwitch.reason})`);
    }

    const idempotencyKey = context.idempotencyKey;
    if (idempotencyKey) {
      const cachedResult = await this.container.idempotencyService.getResult(idempotencyKey);
      if (cachedResult) return cachedResult;
      
      const canProceed = await this.container.idempotencyService.start(idempotencyKey);
      if (!canProceed) throw new Error('IDEMPOTENCY_LOCKED');
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

      this._validateContract(action, context);

      // We use require for orchestrator for now if it's not in container
      const orchestrator = require('./orderModificationOrchestrator');
      const result = await (async () => {
        switch (action) {
          case 'PREVIEW': return await orchestrator.preview(orderId, context.modifications, actor);
          case 'CANCEL': return await this.container.orderService.cancelOrder(orderId, actor, context.reason);
          case 'UPDATE_STATUS': return await this.container.orderService.updateOrderStatus(orderId, context.status, context.version, actor);
          case 'CREATE_ORDER': return await this.container.orderService.createOrder(context.orderData, actor);
          // ... add other cases as needed or use a generic router
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
      await this.container.circuitBreakerService.recordFailure('ORDER_OPERATIONS');
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
    if (action === 'APPROVE_CANCEL') return await orderService.approveCancellation(orderId, actor);
    if (action === 'REJECT_CANCEL') return await orderService.rejectCancellation(orderId, actor, context.rejectionReason);
    if (action === 'UPDATE_TIMER') return await orderService.updateOrderTimer(orderId, context.estimatedReadyAt, actor);
    if (action === 'UPDATE_PREP_TIME') return await orderService.updatePreparationTime(orderId, context.minutes, actor);
    if (action === 'SUBMIT_RATING') return await orderService.submitOrderRating(orderId, actor, context.rating, context.comment);
    if (action === 'BATCH_ACCEPT') return await orderService.batchAcceptOrders(actor);
    
    throw new Error(`UNSUPPORTED_GATEWAY_ACTION: ${action}`);
  }

  _validateContract(action, context) {
    if (action !== 'PREVIEW' && !context.idempotencyKey) throw new Error('MISSING_IDEMPOTENCY_KEY');
  }

  _getLockKey(orderId, action, context, actor) {
    if (orderId) return `lock:order:${orderId}`;
    return `lock:gateway:${action}:${actor?.id || 'unknown'}:${Date.now()}`;
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
