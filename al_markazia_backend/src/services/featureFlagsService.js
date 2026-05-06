/**
 * 🚦 Feature Flags Service (Enterprise Grade)
 */
class FeatureFlagsService {
  constructor(container) {
    this.container = container;
    this.redis = container.redis;
    this.logger = container.logger;
  }

  async isEnabled(flagName, userId = null) {
    try {
      const flag = await this.redis.get(`feature:${flagName}`);
      let data = flag ? JSON.parse(flag) : null;
      
      const defaults = {
        'ENFORCE_BRANCH_ISOLATION': { enabled: false, rolloutPercentage: 100 },
        'ENFORCE_USER_STATUS_CHECK': { enabled: false, rolloutPercentage: 100 },
        'BRANCH_AWARE_SOCKET_ROOMS': { enabled: false, rolloutPercentage: 100 },
        'CSRF_STRICT_MODE': { enabled: false, rolloutPercentage: 100 },
        'DEVICE_FINGERPRINT_TOLERANCE': { enabled: true, rolloutPercentage: 100 },
        'USE_QUERY_OPTIMIZER': { enabled: true, rolloutPercentage: 100 },
      };

      if (!data) {
        data = defaults[flagName] || { enabled: false, rolloutPercentage: 100 };
      }

      // 1. Absolute Disable
      if (!data.enabled) return false;

      // 2. Full Rollout or No User Context
      if (!data.rolloutPercentage || data.rolloutPercentage >= 100 || !userId) {
        return data.enabled;
      }

      // 3. 🚀 [SEC-FIX] Gradual Rollout: Sticky Bucket Logic
      const hash = this._getHash(String(userId) + flagName);
      const userBucket = hash % 100;

      return userBucket < data.rolloutPercentage;
    } catch (err) {
      this.logger.error('[FeatureFlag] Error checking flag', { flagName, error: err.message });
      return false;
    }
  }

  async setFlag(flagName, enabled, rolloutPercentage = 100) {
    const payload = { 
      enabled, 
      rolloutPercentage: Math.min(100, Math.max(0, rolloutPercentage)),
      updatedAt: new Date().toISOString() 
    };
    await this.redis.setex(`feature:${flagName}`, 86400, JSON.stringify(payload));
    this.logger.info(`[FeatureFlag] '${flagName}': enabled=${enabled}, rollout=${payload.rolloutPercentage}%`);
  }

  /**
   * 🛡️ Consistent Numeric Hash
   */
  _getHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
}

// --- 🛡️ Backward Compatibility ---
const getContainer = () => require('../lib/container');
const proxy = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'FeatureFlagsService') return FeatureFlagsService;
    const service = getContainer().featureFlagsService;
    const val = service[prop];
    return typeof val === 'function' ? val.bind(service) : val;
  }
});

module.exports = proxy;
module.exports.FeatureFlagsService = FeatureFlagsService;
