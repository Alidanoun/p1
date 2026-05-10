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

      // 2. Fetch from DB (Legacy + New Policies)
      const [settings, loyalty, policies] = await Promise.all([
        prisma.systemSettings.findUnique({ where: { key: 'system_config' } }),
        prisma.loyaltyConfig.findFirst(),
        prisma.businessPolicy.findMany({ where: { isActive: true } })
      ]);

      // 3. Map policies into a structured object
      const policyMap = {};
      policies.forEach(p => {
        policyMap[p.key] = p.value;
      });

      const config = {
        business: {
          maxCancellationReasonLength: policyMap['MAX_CANCELLATION_REASON_LENGTH']?.val || settings?.businessConfig?.maxCancellationReasonLength || 500,
          maxRating: policyMap['MAX_RATING']?.val || settings?.businessConfig?.maxRating || 5,
          defaultDeliveryFee: policyMap['DEFAULT_DELIVERY_FEE']?.val || settings?.defaultDeliveryFee || 1.0,
          freeCancelWindowMinutes: policyMap['FREE_CANCEL_WINDOW_MINUTES']?.val || settings?.freeCancelWindowMinutes || 5,
          slaPrepTimeMinutes: policyMap['SLA_PREP_TIME']?.val || 20,
          slaDeliveryTimeMinutes: policyMap['SLA_DELIVERY_TIME']?.val || 15,
          peakMultiplier: policyMap['PEAK_MULTIPLIER']?.val || 1.0,
          autoCancelTimeoutMinutes: policyMap['AUTO_CANCEL_TIMEOUT']?.val || 15
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

      // 4. Store in Cache
      await redis.set(this.CACHE_KEY, JSON.stringify(config), 'EX', this.CACHE_TTL);
      return config;
    } catch (err) {
      logger.error('Failed to fetch system config', { error: err.message });
      return this._getSafeModeFallbacks();
    }
  }

  /**
   * 🛠️ Seed Initial Policies (Run once or on demand)
   */
  async seedInitialPolicies() {
    const defaults = [
      { key: 'SLA_PREP_TIME', value: { val: 20, unit: 'minutes' }, category: 'SLA', description: 'Standard food preparation time' },
      { key: 'SLA_DELIVERY_TIME', value: { val: 15, unit: 'minutes' }, category: 'SLA', description: 'Standard delivery time from branch to customer' },
      { key: 'DEFAULT_DELIVERY_FEE', value: { val: 1.0, unit: 'JOD' }, category: 'PRICING', description: 'Base delivery fee when no zone is matched' },
      { key: 'FREE_CANCEL_WINDOW_MINUTES', value: { val: 5, unit: 'minutes' }, category: 'CANCELLATION', description: 'Time window for free customer cancellation' },
      { key: 'PEAK_MULTIPLIER', value: { val: 1.0, unit: 'ratio' }, category: 'PRICING', description: 'Price multiplier during peak hours' },
      { key: 'AUTO_CANCEL_TIMEOUT', value: { val: 15, unit: 'minutes' }, category: 'CANCELLATION', description: 'Timeout for administrative cancellation response' }
    ];

    try {
      for (const policy of defaults) {
        await prisma.businessPolicy.upsert({
          where: { key: policy.key },
          update: {},
          create: policy
        });
      }
      logger.info('🚀 Business Policies Seeded Successfully');
      await this.refreshCache();
    } catch (err) {
      logger.error('Failed to seed policies', { error: err.message });
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
