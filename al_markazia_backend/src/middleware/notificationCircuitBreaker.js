const CircuitBreaker = require('opossum');
const logger = require('../utils/logger');

/**
 * ⚡ Notification Circuit Breaker (Phase 1 Protection)
 * Protects the system from cascading failures if FCM or Socket.io are down.
 */

const options = {
  timeout: 5000,      // If a request takes longer than 5s, count it as a failure
  errorThresholdPercentage: 50, // Open circuit if 50% of requests fail
  resetTimeout: 30000 // Wait 30s before trying again
};

/**
 * Wrapper for FCM sending
 */
const fcmBreaker = new CircuitBreaker(async (sendFn, ...args) => {
  return await sendFn(...args);
}, options);

fcmBreaker.on('open', () => logger.error('[CircuitBreaker] 🚨 FCM Circuit OPEN! Service suspended.'));
fcmBreaker.on('halfOpen', () => logger.info('[CircuitBreaker] 🟡 FCM Circuit HALF-OPEN. Testing...'));
fcmBreaker.on('close', () => logger.info('[CircuitBreaker] 🟢 FCM Circuit CLOSED. Service recovered.'));

/**
 * Middleware wrapper (optional, but useful for manual triggers)
 */
const circuitBreakerMiddleware = (req, res, next) => {
  if (fcmBreaker.opened) {
    return res.status(503).json({ 
      success: false, 
      message: 'Notification service temporarily unavailable (Circuit Open)' 
    });
  }
  next();
};

module.exports = {
  fcmBreaker,
  circuitBreakerMiddleware
};
