/**
 * 📊 Metrics Service
 * High-performance counters and gauges using Redis.
 * Supports Phase 1: Observability Layer.
 */

const redis = require('../lib/redis');
const logger = require('../utils/logger');
const { getRequestId } = require('../utils/context');

class MetricsService {
  constructor() {
    this.prefix = 'metrics:';
  }

  /**
   * 📈 Increment a counter
   */
  async increment(metricName, value = 1) {
    try {
      const key = `${this.prefix}${metricName}`;
      await redis.incrby(key, value);
    } catch (err) {
      logger.error('[Metrics] Failed to increment', { metricName, error: err.message });
    }
  }

  /**
   * 💰 Track financial volume (Gauge-like)
   */
  async trackFinancial(type, amount) {
    try {
      const key = `${this.prefix}finance:${type}:total`;
      await redis.incrbyfloat(key, amount);
    } catch (err) {
      logger.error('[Metrics] Failed to track financial', { type, error: err.message });
    }
  }

  /**
   * ⏱️ Record latency
   */
  async recordLatency(metricName, durationMs) {
    try {
      const key = `${this.prefix}latency:${metricName}`;
      // Store moving average or histogram (simplified here as list for aggregation)
      await redis.lpush(key, durationMs);
      await redis.ltrim(key, 0, 999); // Keep last 1000 samples
    } catch (err) {
      logger.error('[Metrics] Failed to record latency', { metricName, error: err.message });
    }
  }

  /**
   * 🔍 Get current snapshot for Dashboard
   */
  async getSnapshot() {
    const keys = await redis.keys(`${this.prefix}*`);
    const snapshot = {};
    
    for (const key of keys) {
      const value = await redis.get(key);
      const shortKey = key.replace(this.prefix, '');
      snapshot[shortKey] = value;
    }
    
    return snapshot;
  }
}

module.exports = new MetricsService();
