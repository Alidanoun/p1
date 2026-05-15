const logger = require('./logger');

/**
 * ⚡ Enterprise Circuit Breaker
 * Protects the system from cascading failures by isolating failing external services.
 * States: 
 * - CLOSED: Normal operation.
 * - OPEN: Failure detected, immediate rejection.
 * - HALF_OPEN: Testing if the service has recovered.
 */
class CircuitBreaker {
  constructor(serviceName, options = {}) {
    this.serviceName = serviceName;
    this.failureThreshold = options.failureThreshold || 5; // Failures before opening
    this.resetTimeout = options.resetTimeout || 30000;      // Time in ms before trying half-open
    this.successThreshold = options.successThreshold || 2; // Successes in half-open to close
    
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
  }

  async execute(action, fallback = null) {
    if (this.state === 'OPEN') {
      if (Date.now() > this.nextAttempt) {
        this.state = 'HALF_OPEN';
        logger.warn(`⚡ [CircuitBreaker] ${this.serviceName} entering HALF_OPEN state.`);
      } else {
        if (fallback) return fallback();
        throw new Error(`CIRCUIT_OPEN: Service ${this.serviceName} is currently unavailable.`);
      }
    }

    try {
      const result = await action();
      
      if (this.state === 'HALF_OPEN') {
        this.successCount++;
        if (this.successCount >= this.successThreshold) {
          this.close();
        }
      }
      
      return result;
    } catch (error) {
      this.handleFailure(error);
      if (fallback) return fallback();
      throw error;
    }
  }

  handleFailure(error) {
    this.failureCount++;
    this.successCount = 0; // Reset success count on any failure in HALF_OPEN

    logger.error(`⚡ [CircuitBreaker] ${this.serviceName} failure (${this.failureCount}/${this.failureThreshold})`, { 
      error: error.message,
      state: this.state
    });

    if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      this.open();
    } else if (this.state === 'HALF_OPEN') {
      this.open(); // Re-open immediately if a trial request fails
    }
  }

  open() {
    this.state = 'OPEN';
    this.nextAttempt = Date.now() + this.resetTimeout;
    logger.error(`⚡ [CircuitBreaker] ${this.serviceName} is now OPEN. Re-attempt scheduled at ${new Date(this.nextAttempt).toISOString()}`);
  }

  close() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    logger.info(`⚡ [CircuitBreaker] ${this.serviceName} is now CLOSED. Recovery confirmed.`);
  }
}

// 🏛️ Registry to share instances across the app
const registry = new Map();

const getBreaker = (serviceName, options) => {
  if (!registry.has(serviceName)) {
    registry.set(serviceName, new CircuitBreaker(serviceName, options));
  }
  return registry.get(serviceName);
};

module.exports = { CircuitBreaker, getBreaker };
