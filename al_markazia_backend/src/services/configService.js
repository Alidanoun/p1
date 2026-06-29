const logger = require('../utils/logger');
const redis = require('../lib/redis');
const { DateTime } = require('luxon');

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
    this.PEAK_HOURS = [
      { start: 12, end: 14 },
      { start: 19, end: 21 }
    ];
    this.DEFAULT_PEAK_MULTIPLIER = 1.5;
  }

  isPeakHour(timezone = 'Asia/Amman') {
    const hour = DateTime.now().setZone(timezone).hour;
    return this.PEAK_HOURS.some(s => hour >= s.start && hour < s.end);
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

      const loyaltyConfig = await getPrisma().loyaltyConfig.findFirst();

      const parsedTax = parseFloat(policyMap['TAX_RATE']?.val);
      const taxRate = isNaN(parsedTax) ? 0.16 : parsedTax;

      const dbPeakMultiplier = policyMap['PEAK_MULTIPLIER']?.val || null;
      const isPeak = this.isPeakHour();
      const peakMultiplier = dbPeakMultiplier !== null ? dbPeakMultiplier : (isPeak ? this.DEFAULT_PEAK_MULTIPLIER : 1.0);

      const config = {
        business: {
          taxRate: taxRate,
          maxCancellationReasonLength: policyMap['MAX_CANCELLATION_REASON_LENGTH']?.val || 500,
          maxRating: policyMap['MAX_RATING']?.val || 5,
          defaultDeliveryFee: policyMap['DEFAULT_DELIVERY_FEE']?.val || 1.0,
          freeCancelWindowMinutes: policyMap['FREE_CANCEL_WINDOW_MINUTES']?.val || 5,
          slaPrepTimeMinutes: policyMap['SLA_PREP_TIME_MINUTES']?.val || 30,
          slaDeliveryTimeMinutes: policyMap['SLA_DELIVERY_TIME_MINUTES']?.val || 30,
          peakMultiplier: peakMultiplier,
          isPeakHour: isPeak
        },
        security: {
          maxLoginAttempts: policyMap['SEC_MAX_LOGIN_ATTEMPTS']?.val || 5,
          lockDurationMinutes: policyMap['SEC_LOCK_DURATION']?.val || 15,
          timingDelayMs: policyMap['SEC_TIMING_DELAY']?.val || 300,
          passwordMinLength: policyMap['SEC_MIN_PASSWORD_LENGTH']?.val || 8
        },
        loyalty: {
          pointsPerJod: loyaltyConfig?.pointsPerJod ?? policyMap['LOYALTY_POINTS_PER_JOD']?.val ?? 10,
          minPointsToRedeem: loyaltyConfig?.minPointsToRedeem ?? policyMap['LOYALTY_MIN_REDEEM']?.val ?? 500,
          pointsToJodRate: loyaltyConfig?.pointsToJodRate ?? policyMap['LOYALTY_POINTS_TO_JOD_RATE']?.val ?? 100,
        }
      };

      // 🛡️ Merge with advanced config from SystemSettings
      const masterConfig = await getPrisma().systemSettings.findUnique({
        where: { key: 'system_config' }
      });

      if (masterConfig) {
        if (masterConfig.businessConfig) {
          const bConf = typeof masterConfig.businessConfig === 'string' ? JSON.parse(masterConfig.businessConfig) : masterConfig.businessConfig;
          Object.assign(config.business, bConf);
        }
        if (masterConfig.securityConfig) {
          const sConf = typeof masterConfig.securityConfig === 'string' ? JSON.parse(masterConfig.securityConfig) : masterConfig.securityConfig;
          Object.assign(config.security, sConf);
        }
      }

      // Background cache update (don't await to avoid slowing down request)
      redis.set(cacheKey, JSON.stringify(config), 'EX', this.CACHE_TTL).catch(() => {});
      
      return config;
    } catch (err) {
      logger.error('ConfigService Failure - Using Safe Mode Fallbacks', { error: err.message });
      return this._getSafeModeFallbacks();
    }
  }

  _getSafeModeFallbacks() {
    const isPeak = this.isPeakHour();
    return {
      business: { taxRate: 0.16, maxCancellationReasonLength: 500, maxRating: 5, defaultDeliveryFee: 1.0, freeCancelWindowMinutes: 5, slaPrepTimeMinutes: 30, slaDeliveryTimeMinutes: 30, peakMultiplier: isPeak ? this.DEFAULT_PEAK_MULTIPLIER : 1.0, isPeakHour: isPeak },
      security: { maxLoginAttempts: 5, lockDurationMinutes: 15, timingDelayMs: 300, passwordMinLength: 8 },
      loyalty: { pointsPerJod: 10, minPointsToRedeem: 500, pointsToJodRate: 100 }
    };
  }

  async getAnnouncementText() {
    try {
      const cached = await redis.get('system:announcement').catch(() => null);
      if (cached !== null) return cached;

      const setting = await getPrisma().systemSettings.findUnique({
        where: { key: 'announcementText' }
      });
      const val = setting ? setting.value : '';
      await redis.set('system:announcement', val, 'EX', 3600).catch(() => {});
      return val;
    } catch (err) {
      logger.error('Failed to get announcement text', { error: err.message });
      return '';
    }
  }

  async refreshCache() {
    try {
      await redis.del(this.CACHE_KEY);
      await redis.del('system:announcement');
      return await this.getFullConfig();
    } catch (err) {
      logger.error('Failed to refresh config cache', { error: err.message });
      return this._getSafeModeFallbacks();
    }
  }
}

module.exports = new ConfigService();
