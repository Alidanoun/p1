const redis = require('../lib/redis');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * 🌍 Global Coordinator (Big Tech Level 9)
 * Orchestrates multi-instance consensus and ensures global coordination for
 * cross-instance singleton operations (Alerts, Rollouts, Config Audits).
 */
class GlobalCoordinator {
  constructor() {
    this.nodeId = uuidv4();
  }

  /**
   * Acquires a global lease for an operation.
   * Ensures that only one node in the entire cluster performs the task.
   */
  async acquireGlobalLease(operationKey, ttlMs = 5000) {
    const lockKey = `lock:global:${operationKey}`;
    try {
      const acquired = await redis.set(lockKey, this.nodeId, 'NX', 'PX', ttlMs);
      return acquired === 'OK';
    } catch (err) {
      return false;
    }
  }

  /**
   * Coordinates a global alert dispatch with deduplication.
   */
  async coordinateAlert(alertId, dispatchFn) {
    const dedupeKey = `alert:dedupe:${alertId}`;
    
    // Check-and-Set for global deduplication (Window: 5 min)
    const set = await redis.set(dedupeKey, this.nodeId, 'NX', 'EX', 300);
    
    if (set === 'OK') {
      logger.info(`[Coordinator] 🌐 Coordinating Global Alert: ${alertId}`);
      await dispatchFn();
    }
  }
}

module.exports = new GlobalCoordinator();
