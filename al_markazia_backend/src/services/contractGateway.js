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
    // Prevents conflicts with Cron jobs or concurrent admins
    const acquired = await redis.set(lockKey, 'locked', 'NX', 'EX', 30); // 30s lock
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
      logger.info(`[Gateway] 🛡️ Contract validated for Order ${orderId}. Action: ${action}`);

      // 2. 📝 Mandatory Contract Validation
      this._validateContract(action, context);

      // 3. 🚀 Route to Orchestrator based on action
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
            // 🛡️ Safe Write Mode Protection
            const isWriteEnabled = process.env.ENABLE_ORDER_MODIFICATION_WRITE === 'true';
            if (!isWriteEnabled) {
              throw new Error('SYSTEM_GUARD:WRITE_OPERATIONS_DISABLED_DURING_STABILIZATION');
            }
            
            if (action === 'REQUEST') {
              return await orchestrator.request(
                orderId, 
                actor.id, 
                context.modifications, 
                context.idempotencyKey,
                actor
              );
            } else if (action === 'APPLY') {
              return await orchestrator.apply(context.eventId, actor.id, context.idempotencyKey);
            } else if (action === 'CANCEL') {
              const orderService = require('./orderService');
              return await orderService.cancelOrder(
                orderId, 
                actor, 
                context.reason
              );
            } else if (action === 'APPROVE_CANCEL') {
              const orderService = require('./orderService');
              return await orderService.approveCancellation(orderId, actor);
            } else if (action === 'REJECT_CANCEL') {
              const orderService = require('./orderService');
              return await orderService.rejectCancellation(orderId, actor, context.rejectionReason);
            } else if (action === 'UPDATE_STATUS') {
              const orderService = require('./orderService');
              return await orderService.updateOrderStatus(orderId, context.status, context.version, actor);
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
  }
}

module.exports = new ContractGateway();
