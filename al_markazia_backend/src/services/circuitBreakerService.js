/**
 * 🛡️ Global Circuit Breaker Service
 */
class CircuitBreakerService {
  constructor(container) {
    this.container = container;
    this.redis = container.redis;
    this.logger = container.logger;
    this.states = new Map();
    this.failureCounters = new Map();
    this.config = { failureThreshold: 3, resetTimeout: 30000 };
  }

  async getState(serviceName) {
    try {
      const state = await this.redis.get(`circuit:${serviceName}:state`);
      return state || this.states.get(serviceName) || 'CLOSED';
    } catch (err) {
      this.logger.logError('CircuitBreaker.getState', err, { serviceName });
      return this.states.get(serviceName) || 'CLOSED';
    }
  }

  async isOpen(serviceName) {
    const state = await this.getState(serviceName);
    return state === 'OPEN';
  }

  async recordFailure(serviceName) {
    const count = (this.failureCounters.get(serviceName) || 0) + 1;
    this.failureCounters.set(serviceName, count);
    this.logger.warn(`[CircuitBreaker] Failure recorded for ${serviceName}`, { count });
    if (count >= this.config.failureThreshold) await this.openCircuit(serviceName);
  }

  async recordSuccess(serviceName) {
    this.failureCounters.set(serviceName, 0);
    const currentState = await this.getState(serviceName);
    if (currentState !== 'CLOSED') await this.closeCircuit(serviceName);
  }

  async openCircuit(serviceName) {
    this.logger.error(`[CircuitBreaker] 🚨 OPENING CIRCUIT for ${serviceName}.`);
    this.states.set(serviceName, 'OPEN');
    try {
      await this.redis.set(`circuit:${serviceName}:state`, 'OPEN', 'PX', this.config.resetTimeout);
    } catch (err) {
      this.logger.logError('CircuitBreaker.openCircuit', err, { serviceName });
    }
    
    // Fallback to local require if eventBus not in container
    const eventBus = require('../lib/eventBus');
    await eventBus.emitSafe('CIRCUIT_OPENED', { service: serviceName });
    setTimeout(() => this.halfOpenCircuit(serviceName), this.config.resetTimeout);
  }

  async halfOpenCircuit(serviceName) {
    const state = await this.getState(serviceName);
    if (state !== 'OPEN') return;
    this.logger.info(`[CircuitBreaker] 🟡 HALF-OPEN transition for ${serviceName}`);
    this.states.set(serviceName, 'HALF_OPEN');
    try { await this.redis.set(`circuit:${serviceName}:state`, 'HALF_OPEN'); } catch (err) {
      this.logger.logError('CircuitBreaker.halfOpenCircuit', err, { serviceName });
    }
  }

  async closeCircuit(serviceName) {
    this.logger.info(`[CircuitBreaker] ✅ CLOSING CIRCUIT for ${serviceName}.`);
    this.states.set(serviceName, 'CLOSED');
    this.failureCounters.set(serviceName, 0);
    try { await this.redis.del(`circuit:${serviceName}:state`); } catch (err) {
      this.logger.logError('CircuitBreaker.closeCircuit', err, { serviceName });
    }
  }
}

// --- 🛡️ Backward Compatibility ---
const getContainer = () => require('../lib/container');
const proxy = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'CircuitBreakerService') return CircuitBreakerService;
    const service = getContainer().circuitBreakerService;
    const val = service[prop];
    return typeof val === 'function' ? val.bind(service) : val;
  }
});

module.exports = proxy;
module.exports.CircuitBreakerService = CircuitBreakerService;
