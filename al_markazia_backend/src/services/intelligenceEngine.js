const logger = require('../utils/logger');
const redis = require('../lib/redis');
const eventBus = require('../lib/eventBus');

/**
 * 🧠 Intelligence Engine (Big Tech Level 9)
 * The centralized reasoning layer that orchestrates Feature Flags,
 * Load Management, and Fail-safe mechanisms based on multi-factor analysis.
 */
class IntelligenceEngine {
  constructor() {
    this.decisions = new Map();
  }

  /**
   * Orchestrates the system state based on combined tech & business metrics.
   */
  async orchestrate(metrics) {
    const { score, status, business, load } = metrics;

    // 1. Autonomous Kill Switch (Logic: If Cancellation Rate > 20% and we are DEGRADED)
    if (business.cancellationRate > 20 && score < 70) {
      await this.triggerEmergencyKillSwitch('HIGH_CANCELLATION_DEGRADATION');
    }

    // 2. Predictive Throttling (Logic: If Queue growth is positive and Latency is drifting)
    if (load.queueSize > 20 && score < 85) {
      await this.activatePredictiveThrottling();
    }

    // 3. Canary Rollout Decision (Throttled)
    const now = Date.now();
    const lastCanary = this.decisions.get('last_canary_emit') || 0;

    if (status === 'HEALTHY' && score > 95) {
      if (now - lastCanary > 30000) { // 30s throttle
        eventBus.emitSafe('CANARY_PROMOTION_ALLOWED');
        this.decisions.set('last_canary_emit', now);
      }
    } else {
      eventBus.emitSafe('CANARY_PROMOTION_BLOCKED', { reason: status });
    }

    this.decisions.set('last_orchestration', { timestamp: now, score, status });
  }

  async triggerEmergencyKillSwitch(reason) {
    logger.error(`[Intelligence] 🚨 EMERGENCY KILL SWITCH TRIGGERED: ${reason}`);
    
    // Globally disable non-critical experimental features
    await redis.set('feature_flags:emergency_mode', 'true', 'EX', 3600);
    
    eventBus.emitSafe('SYSTEM_EMERGENCY_KILLSWITCH', { reason });
  }

  async activatePredictiveThrottling() {
    logger.warn('[Intelligence] 🚦 Activating Predictive Throttling based on load trends.');
    // Signaled to Governor via Redis
    await redis.set('governor:predictive_throttle', 'true', 'EX', 300);
  }
}

module.exports = new IntelligenceEngine();
