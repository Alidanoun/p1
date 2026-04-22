const logger = require('../utils/logger');
const redis = require('../lib/redis');
const eventBus = require('../lib/eventBus');

/**
 * 🛡️ Global Circuit Breaker Service
 * Manages service availability states (CLOSED, OPEN, HALF_OPEN)
 * with Redis persistence and In-memory fallback.
 */
class CircuitBreakerService {
  constructor() {
    this.states = new Map(); // In-memory fallback
    this.failureCounters = new Map();
    this.config = {
      failureThreshold: 3,
      resetTimeout: 30000, // 30 seconds to attempt Half-Open
    };
  }

  async getState(serviceName) {
    try {
      const state = await redis.get(`circuit:${serviceName}:state`);
      return state || this.states.get(serviceName) || 'CLOSED';
    } catch (err) {
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

    logger.warn(`[CircuitBreaker] Failure recorded for ${serviceName}`, { count });

    if (count >= this.config.failureThreshold) {
      await this.openCircuit(serviceName);
    }
  }

  async recordSuccess(serviceName) {
    this.failureCounters.set(serviceName, 0);
    const currentState = await this.getState(serviceName);
    
    if (currentState !== 'CLOSED') {
      await this.closeCircuit(serviceName);
    }
  }

  async openCircuit(serviceName) {
    logger.error(`[CircuitBreaker] 🚨 OPENING CIRCUIT for ${serviceName}. Hard gate activated.`);
    
    this.states.set(serviceName, 'OPEN');
    try {
      await redis.set(`circuit:${serviceName}:state`, 'OPEN', 'PX', this.config.resetTimeout);
    } catch (err) {
      logger.error('[CircuitBreaker] Redis write failed, using memory fallback');
    }

    eventBus.emitSafe('CIRCUIT_OPENED', { service: serviceName });

    // Schedule auto-healing attempt (Half-Open)
    setTimeout(() => this.halfOpenCircuit(serviceName), this.config.resetTimeout);
  }

  async halfOpenCircuit(serviceName) {
    const state = await this.getState(serviceName);
    if (state !== 'OPEN') return;

    logger.info(`[CircuitBreaker] 🟡 Attempting HALF-OPEN transition for ${serviceName}`);
    this.states.set(serviceName, 'HALF_OPEN');
    try {
      await redis.set(`circuit:${serviceName}:state`, 'HALF_OPEN');
    } catch (err) {}
    
    eventBus.emitSafe('CIRCUIT_HALF_OPEN', { service: serviceName });
  }

  async closeCircuit(serviceName) {
    logger.info(`[CircuitBreaker] ✅ CLOSING CIRCUIT for ${serviceName}. Service restored.`);
    this.states.set(serviceName, 'CLOSED');
    this.failureCounters.set(serviceName, 0);
    try {
      await redis.del(`circuit:${serviceName}:state`);
    } catch (err) {}

    eventBus.emitSafe('CIRCUIT_CLOSED', { service: serviceName });
  }
}

module.exports = new CircuitBreakerService();
