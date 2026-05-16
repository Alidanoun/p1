const logger = require('../utils/logger');
const redis = require('../lib/redis');

// Lazy-loaded to avoid circular dependency
const getPrisma = () => require('../lib/prisma');

/**
 * ⚙️ Unified Configuration Service
 * Optimized with Redis caching and Safe-Mode Fallbacks.
 */
class ConfigService {
  constructor() {
    this.CACHE_KEY = 'system:config';
    this.CACHE_TTL = 3600; // 1 hour
  }

  /**
   * 🎯 Get All Configs
   * Implements a 3s Redis timeout to prevent authentication hangs during cache latency.
   */
  async getFullConfig(branchId = null) {
    try {
      const cacheKey = branchId ? `${this.CACHE_KEY}:${branchId}` : this.CACHE_KEY;
      
      // 🏎️ Redis Lookup with 500ms Timeout (Fast Failover)
      const cached = await Promise.race([
        redis.get(cacheKey),
        new Promise((_, reject) => setTimeout(() => reject(new Error('REDIS_TIMEOUT')), 500))
      ]).catch(err => {
        logger.warn('[ConfigService] Redis lookup bypassed or timed out', { error: err.message });
        return null;
      });

      if (cached) return JSON.parse(cached);

      // 🛡️ DB Fallback
      const policies = await getPrisma().businessPolicy.findMany({
        where: { isActive: true, OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] }
      });

      const policyMap = {};
      policies.forEach(p => { policyMap[p.key] = p.value; });

      const config = {
        business: {
          maxCancellationReasonLength: policyMap['MAX_CANCELLATION_REASON_LENGTH']?.val || 500,
          maxRating: policyMap['MAX_RATING']?.val || 5,
          defaultDeliveryFee: policyMap['DEFAULT_DELIVERY_FEE']?.val || 1.0,
          freeCancelWindowMinutes: policyMap['FREE_CANCEL_WINDOW_MINUTES']?.val || 5,
        },
        security: {
          maxLoginAttempts: policyMap['SEC_MAX_LOGIN_ATTEMPTS']?.val || 5,
          lockDurationMinutes: policyMap['SEC_LOCK_DURATION']?.val || 15,
          timingDelayMs: policyMap['SEC_TIMING_DELAY']?.val || 300,
          passwordMinLength: policyMap['SEC_MIN_PASSWORD_LENGTH']?.val || 8
        },
        loyalty: {
          pointsPerJod: policyMap['LOYALTY_POINTS_PER_JOD']?.val || 10,
          minPointsToRedeem: policyMap['LOYALTY_MIN_REDEEM']?.val || 500,
        }
      };

      // Background cache update (don't await to avoid slowing down request)
      redis.set(cacheKey, JSON.stringify(config), 'EX', this.CACHE_TTL).catch(() => {});
      
      return config;
    } catch (err) {
      logger.error('ConfigService Failure - Using Safe Mode Fallbacks', { error: err.message });
      return this._getSafeModeFallbacks();
    }
  }

  _getSafeModeFallbacks() {
    return {
      business: { maxCancellationReasonLength: 500, maxRating: 5, defaultDeliveryFee: 1.0, freeCancelWindowMinutes: 5 },
      security: { maxLoginAttempts: 5, lockDurationMinutes: 15, timingDelayMs: 300, passwordMinLength: 8 },
      loyalty: { pointsPerJod: 10, minPointsToRedeem: 500 }
    };
  }
}

module.exports = new ConfigService();
