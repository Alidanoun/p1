const redis = require('../lib/redis');
const logger = require('../utils/logger');

/**
 * 🚦 Feature Flags Service (Enterprise Grade)
 * Allows dynamic toggling of security features without server restarts.
 * Uses Redis for distributed consistency across multiple backend instances.
 */
class FeatureFlagsService {
  /**
   * Check if a specific security feature is enabled.
   * @param {string} flagName - The identifier of the feature.
   * @returns {Promise<boolean>}
   */
  static async isEnabled(flagName) {
    try {
      const flag = await redis.get(`feature:${flagName}`);
      if (flag) {
        const data = JSON.parse(flag);
        return data.enabled === true;
      }
      
      // Default Values (Safe Defaults: Most features OFF until manually verified)
      const defaults = {
        'ENFORCE_BRANCH_ISOLATION': false,      // Global database-level filtering
        'ENFORCE_USER_STATUS_CHECK': false,    // isActive check on every request
        'BRANCH_AWARE_SOCKET_ROOMS': false,    // Multi-tenant Socket.IO rooms
        'CSRF_STRICT_MODE': false,             // Global CSRF enforcement
        'DEVICE_FINGERPRINT_TOLERANCE': true,  // Allow IP changes if UA matches (ON by default for UX)
      };
      
      return defaults[flagName] || false;
    } catch (err) {
      logger.error('[FeatureFlag] Error checking flag, falling back to safe default', { flagName, error: err.message });
      return false; // Fail-safe: feature disabled
    }
  }

  /**
   * Update a feature flag status.
   * @param {string} flagName 
   * @param {boolean} enabled 
   */
  static async setFlag(flagName, enabled) {
    const payload = { 
      enabled, 
      updatedAt: new Date().toISOString() 
    };
    await redis.set(`feature:${flagName}`, JSON.stringify(payload));
    logger.info(`[FeatureFlag] Security feature '${flagName}' is now ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }
}

module.exports = FeatureFlagsService;
