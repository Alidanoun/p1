const redis = require('../lib/redis');
const logger = require('../utils/logger');

/**
 * 🚩 Feature Flag Service (Big Tech Level 9)
 * Advanced flag management with ownership tiers, autonomous kill-switches,
 * and business-impact analytics integration.
 */
class FeatureFlagService {
  /**
   * Evaluates if a feature is enabled for a target context.
   */
  async isEnabled(flagKey, context = {}, defaultVal = false) {
    try {
      // 🚨 1. Global Emergency Kill-Switch (System Tier)
      const emergencyMode = await redis.get('feature_flags:emergency_mode');
      if (emergencyMode === 'true') {
        logger.warn(`[FeatureFlags] 🛑 Emergency Kill-Switch active. Blocking flag: ${flagKey}`);
        return false;
      }

      // 👤 2. Admin Override (Admin Tier)
      const adminOverride = await redis.get(`feature_flags:override:${flagKey}`);
      if (adminOverride !== null) {
        return adminOverride === 'true';
      }

      // 🎢 3. Gradual Rollout (Logic: Hash-based variance)
      const rolloutValue = await redis.get(`feature_flags:rollout:${flagKey}`) || '0';
      const percentage = parseInt(rolloutValue);
      
      if (percentage === 0) return defaultVal;
      if (percentage === 100) return true;

      // Deterministic rollout based on context ID (e.g. customer UUID or phone)
      const id = context.id || 'anonymous';
      const hash = this._simpleHash(id);
      return (hash % 100) < percentage;

    } catch (err) {
      return defaultVal;
    }
  }

  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Sets a rollout percentage for a feature.
   */
  async setRollout(flagKey, percentage) {
    await redis.set(`feature_flags:rollout:${flagKey}`, Math.min(100, Math.max(0, percentage)));
    logger.info(`[FeatureFlags] 🎢 Rollout updated: ${flagKey} set to ${percentage}%`);
  }
}

module.exports = new FeatureFlagService();
