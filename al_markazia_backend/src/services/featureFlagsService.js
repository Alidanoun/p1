/**
 * 🚦 Feature Flags Service (Enterprise Grade)
 */
class FeatureFlagsService {
  constructor(container) {
    this.container = container;
    this.redis = container.redis;
    this.logger = container.logger;
    this.localCache = new Map();
    this.cacheTTL = 5000; // 5 seconds local cache
  }

  async isEnabled(flagName, userId = null) {
    // 🧠 Local Cache check to avoid Redis pressure
    const cacheKey = `${flagName}:${userId || 'global'}`;
    const cached = this.localCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      return cached.value;
    }

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
        'FEATURE_SECURE_CANCELLATION': { enabled: true, rolloutPercentage: 100 },
        'FEATURE_STRICT_APPROVALS': { enabled: true, rolloutPercentage: 100 },
        'FEATURE_SOCKET_CANONICAL_SYNC': { enabled: false, rolloutPercentage: 100 },
        'ENABLE_READ_REPLICA_ROUTING': { enabled: false, rolloutPercentage: 100 },
      };

      if (!data) {
        data = defaults[flagName] || { enabled: false, rolloutPercentage: 100 };
      }

      const value = data.enabled && (data.rolloutPercentage >= 100 || !userId || (this._getHash(String(userId) + flagName) % 100 < data.rolloutPercentage));
      
      this.localCache.set(cacheKey, { value, timestamp: Date.now() });
      return value;
    } catch (err) {
      this.logger.error('[FeatureFlag] Error checking flag, applying strict deterministic safety mapping', { flagName, error: err.message });
      
      // 🛡️ Strictly Classified Safety baselines
      const failSafeMatrix = {
        // 🔴 Security Critical -> Fail-Safe ON (Maximum Defense)
        'ENFORCE_BRANCH_ISOLATION': true,
        'ENFORCE_USER_STATUS_CHECK': true,
        'CSRF_STRICT_MODE': true,
        'FEATURE_SECURE_CANCELLATION': true,
        'FEATURE_STRICT_APPROVALS': true,
        
        // 🟡 Operational Critical -> Fail-Safe ON (Prevent DB Query Storms)
        'USE_QUERY_OPTIMIZER': true,
        'DEVICE_FINGERPRINT_TOLERANCE': true,
        
        // 🔵 Experimental / Performance -> Fail-Safe OFF (Maintain Stable Legacy Core)
        'FEATURE_SOCKET_CANONICAL_SYNC': false,
        'BRANCH_AWARE_SOCKET_ROOMS': false,
        'ENABLE_READ_REPLICA_ROUTING': false,
      };

      return failSafeMatrix[flagName] !== undefined ? failSafeMatrix[flagName] : false;
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
