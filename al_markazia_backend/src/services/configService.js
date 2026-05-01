const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const redis = require('../lib/redis');

/**
 * ⚙️ Unified Configuration Service
 * Single source of truth for System & Business settings.
 * Optimized with Redis caching.
 */
class ConfigService {
  constructor() {
    this.CACHE_KEY = 'system:config';
    this.CACHE_TTL = 3600; // 1 hour
  }

  /**
   * 🎯 Get All Configs (Cached)
   */
  async getFullConfig() {
    try {
      // 1. Try Cache
      const cached = await redis.get(this.CACHE_KEY);
      if (cached) return JSON.parse(cached);

      // 2. Fetch from DB
      const [settings, loyalty] = await Promise.all([
        prisma.systemSettings.findUnique({ where: { key: 'system_config' } }),
        prisma.loyaltyConfig.findFirst()
      ]);

      const config = {
        business: {
          maxCancellationReasonLength: settings?.businessConfig?.maxCancellationReasonLength || 500,
          maxRating: settings?.businessConfig?.maxRating || 5,
          defaultDeliveryFee: settings?.defaultDeliveryFee || 1.0,
          freeCancelWindowMinutes: settings?.freeCancelWindowMinutes || 5
        },
        security: {
          maxLoginAttempts: settings?.securityConfig?.maxLoginAttempts || 5,
          lockDurationMinutes: settings?.securityConfig?.lockDurationMinutes || 15,
          timingDelayMs: settings?.securityConfig?.timingDelayMs || 300,
          passwordMinLength: 8
        },
        loyalty: {
          pointsPerJod: loyalty?.pointsPerJod || 10,
          minPointsToRedeem: loyalty?.minPointsToRedeem || 500,
          minCompensationPoints: loyalty?.minCompensationPoints || 50,
          rewardExpiryDays: loyalty?.rewardExpiryDays || 30,
          tiers: {
            GOLD: { minOrders: loyalty?.tierGoldMinOrders || 10, multiplier: loyalty?.pointsMultiplierGold || 1.5 },
            PLATINUM: { minOrders: loyalty?.tierPlatinumMinOrders || 25, multiplier: loyalty?.pointsMultiplierPlatinum || 2.0 }
          },
          engagement: {
            REVIEW: loyalty?.reviewPoints || 50,
            REFERRAL: loyalty?.referralPoints || 100,
            SOCIAL_SHARE: loyalty?.socialSharePoints || 20
          }
        }
      };

      // 3. Store in Cache
      await redis.set(this.CACHE_KEY, JSON.stringify(config), 'EX', this.CACHE_TTL);
      return config;
    } catch (err) {
      logger.error('Failed to fetch system config', { error: err.message });
      // Return hardcoded fallbacks as a last resort (Safe Mode)
      return this._getSafeModeFallbacks();
    }
  }

  /**
   * ♻️ Invalidate Cache
   */
  async refreshCache() {
    await redis.del(this.CACHE_KEY);
    return await this.getFullConfig();
  }

  _getSafeModeFallbacks() {
    return {
      business: { maxCancellationReasonLength: 500, maxRating: 5, defaultDeliveryFee: 1.0, freeCancelWindowMinutes: 5 },
      security: { maxLoginAttempts: 5, lockDurationMinutes: 15, timingDelayMs: 300, passwordMinLength: 8 },
      loyalty: { 
        pointsPerJod: 10, minPointsToRedeem: 500, minCompensationPoints: 50, rewardExpiryDays: 30,
        tiers: { GOLD: { minOrders: 10, multiplier: 1.5 }, PLATINUM: { minOrders: 25, multiplier: 2.0 } },
        engagement: { REVIEW: 50, REFERRAL: 100, SOCIAL_SHARE: 20 }
      }
    };
  }
}

module.exports = new ConfigService();
