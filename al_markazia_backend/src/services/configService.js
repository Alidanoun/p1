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
   * 🎯 Get All Configs (Cached & Branch-Aware)
   * Resolves hierarchy: Branch Overrides > Global Policies > Hardcoded Defaults
   */
  async getFullConfig(branchId = null) {
    try {
      const cacheKey = branchId ? `${this.CACHE_KEY}:${branchId}` : this.CACHE_KEY;
      
      // 1. Try Cache
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      // 2. Fetch all active policies
      // We fetch both global (branchId: null) and specific (branchId: branchId)
      const policies = await prisma.businessPolicy.findMany({
        where: {
          isActive: true,
          OR: [
            { branchId: null },
            ...(branchId ? [{ branchId }] : [])
          ]
        }
      });

      // 3. 🗺️ Hierarchical Resolution
      // Branch-specific values always overwrite global values
      const policyMap = {};
      
      // First pass: Global
      policies.filter(p => !p.branchId).forEach(p => {
        policyMap[p.key] = p.value;
      });
      
      // Second pass: Branch Overrides
      if (branchId) {
        policies.filter(p => p.branchId === branchId).forEach(p => {
          policyMap[p.key] = p.value;
        });
      }

      const config = {
        business: {
          maxCancellationReasonLength: policyMap['MAX_CANCELLATION_REASON_LENGTH']?.val || 500,
          maxRating: policyMap['MAX_RATING']?.val || 5,
          defaultDeliveryFee: policyMap['DEFAULT_DELIVERY_FEE']?.val || 1.0,
          freeCancelWindowMinutes: policyMap['FREE_CANCEL_WINDOW_MINUTES']?.val || 5,
          slaPrepTimeMinutes: policyMap['SLA_PREP_TIME']?.val || 20,
          slaDeliveryTimeMinutes: policyMap['SLA_DELIVERY_TIME']?.val || 15,
          peakMultiplier: policyMap['PEAK_MULTIPLIER']?.val || 1.0,
          autoCancelTimeoutMinutes: policyMap['AUTO_CANCEL_TIMEOUT']?.val || 15
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
          minCompensationPoints: policyMap['LOYALTY_MIN_COMPENSATION']?.val || 50,
          rewardExpiryDays: policyMap['LOYALTY_EXPIRY_DAYS']?.val || 30,
          tiers: {
            GOLD: { 
              minOrders: policyMap['LOYALTY_GOLD_MIN_ORDERS']?.val || 10, 
              multiplier: policyMap['LOYALTY_GOLD_MULTIPLIER']?.val || 1.5 
            },
            PLATINUM: { 
              minOrders: policyMap['LOYALTY_PLATINUM_MIN_ORDERS']?.val || 25, 
              multiplier: policyMap['LOYALTY_PLATINUM_MULTIPLIER']?.val || 2.0 
            }
          },
          engagement: {
            REVIEW: policyMap['LOYALTY_ENGAGEMENT_REVIEW']?.val || 50,
            REFERRAL: policyMap['LOYALTY_ENGAGEMENT_REFERRAL']?.val || 100,
            SOCIAL_SHARE: policyMap['LOYALTY_ENGAGEMENT_SHARE']?.val || 20
          }
        }
      };

      // 4. Store in Cache
      await redis.set(cacheKey, JSON.stringify(config), 'EX', this.CACHE_TTL);
      return config;
    } catch (err) {
      logger.error('Failed to fetch system config', { branchId, error: err.message });
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
