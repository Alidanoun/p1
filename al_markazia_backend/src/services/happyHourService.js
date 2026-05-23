const cron = require('node-cron');
const nodemailer = require('nodemailer');
const Decimal = require('decimal.js');
const dateFnsTz = require('date-fns-tz');
const { getDay } = require('date-fns');
const { DEFAULT_TIMEZONE } = require('../config/constants');

// Robust cross-version resolution for date-fns-tz v2 and v3 compatibility
const toZonedTime = dateFnsTz.toZonedTime || dateFnsTz.utcToZonedTime;
const fromZonedTime = dateFnsTz.fromZonedTime || dateFnsTz.zonedTimeToUtc;

// ✅ 5️⃣ Observability Metrics tracking conversions, distribution, and DST transitions
const metrics = {
  happyhour_timezone_conversion_count: 0,
  happyhour_timezone_conversion_errors: 0,
  happyhour_discount_applied_by_timezone: {},
  happyhour_dst_transition_warnings: 0
};

// Safe native validation function
const isValidDate = (d) => d instanceof Date && !isNaN(d);

// ✅ 3️⃣ Timezone Cache Helper to eliminate DB contention under high concurrency
class TimezoneCache {
  constructor(redis, ttl = 3600) {
    this.redis = redis;
    this.ttl = ttl;
  }

  async getBranchTimezone(branchId, prisma) {
    try {
      if (this.redis && typeof this.redis.get === 'function') {
        const cached = await this.redis.get(`tz:branch:${branchId}`);
        if (cached) return cached;
      }

      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { timezone: true }
      });
      const tz = branch?.timezone || DEFAULT_TIMEZONE;

      if (this.redis && typeof this.redis.setex === 'function' && tz) {
        await this.redis.setex(`tz:branch:${branchId}`, this.ttl, tz).catch(() => {});
      }

      return tz;
    } catch (e) {
      return DEFAULT_TIMEZONE;
    }
  }

  async invalidate(branchId) {
    if (!branchId) return;
    try {
      const nodeCache = require('../lib/memoryCache');
      nodeCache.del(`tz_branch_${branchId}`);
      if (this.redis && typeof this.redis.del === 'function') {
        await this.redis.del(`tz:branch:${branchId}`);
      }
    } catch (e) {}
  }
}

/**
 * 🎯 Happy Hour Service (Timezone Safe + Dynamic Eligibility Pricing)
 * Purpose: Manages automated scheduling, timezone conversions, dynamic discount evaluations,
 * and distributed Pub/Sub broadcasts while completely preventing DST transition mismatches.
 */
class HappyHourService {
  constructor(deps = {}) {
    this.instanceId = process.env.INSTANCE_ID || `inst-${Math.random().toString(36).substr(2, 5)}`;
    
    // Support DI injection or auto-resolve default shared modules
    this.prisma = deps.prisma || require('../lib/prisma');
    
    // Only resolve external Redis clients if not explicitly overridden by test injection
    let defaultRedis = deps.redis;
    if (!defaultRedis && process.env.NODE_ENV !== 'test') {
      try {
        defaultRedis = require('../lib/redis');
      } catch (e) {}
    }
    
    this.redis = defaultRedis?.cache || defaultRedis;
    this.pubSub = defaultRedis?.createSubscriber ? defaultRedis.createSubscriber() : (defaultRedis?.subscriber || defaultRedis);
    this.logger = deps.logger || require('../utils/logger');
    
    this.cronJobs = new Map(); // Legacy tracking support
    this.scheduledJobs = new Map(); // Thread-safe dynamic job storage
    this.configs = new Map();
    this.io = null;

    this.tzCache = new TimezoneCache(this.redis);

    // List of standard supported local regions
    this.supportedTimezones = new Set([
      'Africa/Cairo',
      'Asia/Dubai',
      'Asia/Riyadh',
      'Asia/Kuwait',
      'Asia/Qatar',
      'Asia/Bahrain',
      'Asia/Amman',
      'Asia/Beirut',
      'UTC'
    ]);

    // Setup listener if running inside server cluster
    this.setupPubSub();
  }

  setIO(io) {
    this.io = io;
  }

  setupPubSub() {
    try {
      if (this.pubSub && typeof this.pubSub.on === 'function') {
        // Handle connections safely
        this.pubSub.on('connect', () => {
          if (this.logger && typeof this.logger.info === 'function') {
            this.logger.info(`📡 [HappyHourPubSub] Connected: ${this.instanceId}`);
          }
          this.pubSub.subscribe('happyhour:reload').catch(() => {});
        });

        this.pubSub.on('message', async (channel, message) => {
          if (channel === 'happyhour:reload') {
            if (this.logger && typeof this.logger.info === 'function') {
              this.logger.info('🔄 [HappyHour] Reloading configurations across cluster...');
            }
            await this.initialize();
          }
        });
      }
    } catch (e) {}
  }

  /**
   * ✅ 2️⃣ Safe Daylight Saving Time (DST) Aware Time Conversion
   */
  safeConvertTime(timeString, timezone, referenceDate) {
    try {
      const [hours, minutes] = timeString.split(':').map(Number);
      const dateInTz = toZonedTime(referenceDate, timezone);
      dateInTz.setHours(hours, minutes, 0, 0);
      
      const utcTime = fromZonedTime(dateInTz, timezone);
      
      // Check conversion validity for strict DST anomaly defense
      if (!isValidDate(utcTime)) {
        if (this.logger && typeof this.logger.warn === 'function') {
          this.logger.warn('[HappyHour] Invalid time conversion', {
            timeString, timezone, referenceDate
          });
        }
        metrics.happyhour_dst_transition_warnings++;
        return null;
      }
      
      metrics.happyhour_timezone_conversion_count++;
      return utcTime;
    } catch (error) {
      metrics.happyhour_timezone_conversion_errors++;
      if (this.logger && typeof this.logger.error === 'function') {
        this.logger.error('[HappyHour] Time conversion failed', {
          error: error.message, timeString, timezone
        });
      }
      return null;
    }
  }

  _validateTimezone(timezone) {
    if (!timezone || !this.supportedTimezones.has(timezone)) {
      if (this.logger && typeof this.logger.warn === 'function') {
        this.logger.warn('[HappyHour] Unsupported timezone requested, falling back to safe local default', { timezone });
      }
      return DEFAULT_TIMEZONE; // Robust global safe fallback
    }
    return timezone;
  }

  /**
   * ✅ Dynamic Eligibility Checks
   */
  async _isCustomerEligible(customerId, happyHour) {
    if (!happyHour.eligibilityCriteria || happyHour.eligibilityCriteria === 'ALL') {
      return true;
    }

    try {
      if (happyHour.eligibilityCriteria === 'LOYALTY_TIER') {
        let whereClause = { id: customerId };
        if (typeof customerId === 'string' && isNaN(Number(customerId))) {
          whereClause = { uuid: customerId };
        } else if (!isNaN(Number(customerId))) {
          whereClause = { id: Number(customerId) };
        }

        const customer = await this.prisma.customer.findUnique({
          where: whereClause,
          select: { tier: true }
        });
        return customer?.tier === happyHour.loyaltyTierRequired;
      }

      if (happyHour.eligibilityCriteria === 'TARGETED') {
        return happyHour.targetCustomerIds && happyHour.targetCustomerIds.includes(String(customerId));
      }
    } catch (e) {
      return false;
    }

    return false;
  }

  /**
   * ✅ Core Method: Fetch Active Timezone Scoped Sessions
   */
  async getActiveHappyHours(customerId, branchId, referenceTime = new Date()) {
    const refDate = referenceTime instanceof Date ? referenceTime : new Date(referenceTime);
    
    // Resolve precise branch timezone via optimized cache
    const branchTz = await this.tzCache.getBranchTimezone(branchId, this.prisma);
    const comparisonTimezone = this._validateTimezone(branchTz);

    const localTime = toZonedTime(refDate, comparisonTimezone);
    const currentDay = getDay(localTime); // 0 = Sunday, 6 = Saturday

    // Fetch matching operational candidates
    const candidateHours = await this.prisma.happyHour.findMany({
      where: {
        branchId,
        isActive: true
      }
    }).catch(() => []);

    const activeHours = [];

    for (const happyHour of candidateHours) {
      // Evaluate day eligibility
      const days = happyHour.daysOfWeek && happyHour.daysOfWeek.length > 0 
        ? happyHour.daysOfWeek 
        : (happyHour.dayOfWeek !== undefined ? [happyHour.dayOfWeek] : [0,1,2,3,4,5,6]);

      if (!days.includes(currentDay)) continue;

      const appliedTz = happyHour.timezone || comparisonTimezone;
      const startUtc = this.safeConvertTime(happyHour.startTime, appliedTz, localTime);
      const endUtc = this.safeConvertTime(happyHour.endTime, appliedTz, localTime);
      
      // Native instant point comparison
      const nowUtcInstant = refDate.getTime();

      if (!startUtc || !endUtc) continue;

      let startInstant = startUtc.getTime();
      let endInstant = endUtc.getTime();

      // Handle overnight schedules (e.g. 22:00 to 02:00)
      if (endInstant < startInstant) {
        endInstant += 86400000; // Add 24 hours
      }

      const isTimeMatch = nowUtcInstant >= startInstant && nowUtcInstant <= endInstant;
      const isEligible = await this._isCustomerEligible(customerId, happyHour);

      if (isTimeMatch && isEligible) {
        activeHours.push({
          ...happyHour,
          appliedTimezone: appliedTz,
          discountValue: happyHour.discountValue || happyHour.discount || 0,
          discountType: happyHour.discountType || 'PERCENTAGE',
          rewardMultiplier: happyHour.rewardMultiplier || 1.0
        });
      }
    }

    // Return the offer yielding highest benefit if multiple active overlaps exist
    if (activeHours.length > 1) {
      activeHours.sort((a, b) => 
        new Decimal(b.discountValue || 0).minus(a.discountValue || 0).toNumber()
      );
    }

    return activeHours;
  }

  /**
   * ✅ Apply Dynamic Pricing and Audit
   */
  async applyDiscount(orderId, customerId) {
    try {
      // Determine query format
      let queryId = orderId;
      if (typeof orderId === 'string' && !isNaN(Number(orderId))) queryId = Number(orderId);

      const order = await this.prisma.order.findUnique({
        where: { id: queryId },
        include: { 
          orderItems: true,
          branch: { select: { timezone: true } }
        }
      });

      if (!order) {
        throw new Error('ORDER_NOT_FOUND');
      }

      const activeHours = await this.getActiveHappyHours(
        customerId, 
        order.branchId, 
        order.createdAt
      );

      if (activeHours.length === 0) {
        if (this.logger && typeof this.logger.debug === 'function') {
          this.logger.debug('[HappyHour] No applicable timezone discount active during order generation timestamp', { orderId, customerId });
        }
        return null;
      }

      const bestOffer = activeHours[0];
      let discountAmount = new Decimal(0);
      const subtotalDec = new Decimal(order.subtotal || 0);
      const discountValDec = new Decimal(bestOffer.discountValue || bestOffer.discount || 0);

      if (bestOffer.discountType === 'PERCENTAGE') {
        discountAmount = subtotalDec
          .times(discountValDec)
          .dividedBy(100)
          .round(2, Decimal.ROUND_HALF_UP);
      } else if (bestOffer.discountType === 'FIXED') {
        discountAmount = new Decimal(Math.min(
          discountValDec.toNumber(), 
          subtotalDec.toNumber()
        )).round(2, Decimal.ROUND_HALF_UP);
      }

      const updatedOrder = await this.prisma.order.update({
        where: { id: queryId },
        data: {
          happyHourId: bestOffer.id,
          happyHourDiscount: discountAmount.toNumber(),
          happyHourMultiplier: Number(bestOffer.rewardMultiplier || 1.0),
          total: new Decimal(order.total || 0).minus(discountAmount).toNumber()
        }
      });

      // Maintain causal financial audit consistency
      try {
        await this.prisma.orderAuditLog.create({
          data: {
            orderId: queryId,
            eventType: 'HAPPY_HOUR_DISCOUNT',
            eventAction: 'APPLY_DISCOUNT',
            changedBy: 'SYSTEM',
            changedByRole: 'system',
            newData: JSON.stringify({
              happyHourId: bestOffer.id,
              discountType: bestOffer.discountType,
              discountValue: discountValDec.toString(),
              discountAmount: discountAmount.toString(),
              timezone: bestOffer.timezone || bestOffer.appliedTimezone,
              appliedAt: new Date().toISOString()
            })
          }
        });
      } catch (e) {}

      if (this.logger && typeof this.logger.info === 'function') {
        this.logger.info('[HappyHour] Discount applied successfully', {
          orderId,
          customerId,
          discountAmount: discountAmount.toString(),
          timezone: bestOffer.timezone || bestOffer.appliedTimezone
        });
      }

      // Track distribution counts per region
      const tz = bestOffer.timezone || order.branch?.timezone || DEFAULT_TIMEZONE;
      metrics.happyhour_discount_applied_by_timezone[tz] = 
        (metrics.happyhour_discount_applied_by_timezone[tz] || 0) + 1;

      return {
        applied: true,
        happyHourName: bestOffer.name || bestOffer.description || 'ساعة السعادة',
        discountAmount: discountAmount.toString(),
        newTotal: updatedOrder.total.toString()
      };
    } catch (err) {
      if (this.logger && typeof this.logger.error === 'function') {
        this.logger.error('[HappyHour] Failed applying target timezone discount', { orderId, error: err.message });
      }
      throw err;
    }
  }

  /**
   * ✅ 4️⃣ Reschedule with Cron Job Cleanups
   */
  rescheduleHappyHour(config) {
    if (!config || !config.id || !config.branchId) return;
    const jobKey = `happyhour:${config.branchId}:${config.id}`;
    
    // Unregister old instances
    if (this.scheduledJobs.has(jobKey)) {
      const oldJobs = this.scheduledJobs.get(jobKey);
      if (oldJobs.startJob && typeof oldJobs.startJob.stop === 'function') oldJobs.startJob.stop();
      if (oldJobs.endJob && typeof oldJobs.endJob.stop === 'function') oldJobs.endJob.stop();
      if (oldJobs.warnJob && typeof oldJobs.warnJob.stop === 'function') oldJobs.warnJob.stop();
      this.scheduledJobs.delete(jobKey);
      if (this.logger && typeof this.logger.debug === 'function') {
        this.logger.debug('[HappyHour] Cancelled old scheduled job instance safely', { jobKey });
      }
    }

    const timezone = this._validateTimezone(config.timezone);
    const [startH, startM] = (config.startTime || '18:00').split(':');
    const [endH, endM] = (config.endTime || '20:00').split(':');
    const dayOfWeek = config.dayOfWeek ?? config.daysOfWeek?.[0] ?? '*';

    // Instantiation
    const startCron = `${startM} ${startH} * * ${dayOfWeek}`;
    const startJob = cron.schedule(startCron, () => this.triggerStart(config), { timezone, scheduled: true });

    const endCron = `${endM} ${endH} * * ${dayOfWeek}`;
    const endJob = cron.schedule(endCron, () => this.triggerEnd(config), { timezone, scheduled: true });

    let warnM = parseInt(endM) - 15;
    let warnH = parseInt(endH);
    if (warnM < 0) {
      warnM += 60; warnH -= 1;
    }
    const warnCron = `${warnM} ${warnH} * * ${dayOfWeek}`;
    const warnJob = cron.schedule(warnCron, () => this.triggerWarning(config), { timezone, scheduled: true });

    this.scheduledJobs.set(jobKey, { startJob, endJob, warnJob });
    this.cronJobs.set(`${config.id}:start`, startJob);
    this.cronJobs.set(`${config.id}:end`, endJob);
    this.cronJobs.set(`${config.id}:warn`, warnJob);

    if (this.logger && typeof this.logger.debug === 'function') {
      this.logger.debug(`⏰ Rescheduled HH ${config.id} for Branch ${config.branchId} mapped in TZ [${timezone}]`);
    }
  }

  scheduleJob(config) {
    this.rescheduleHappyHour(config);
  }

  /**
   * 🚀 Initialize scheduler lifecycle across entire active domain
   */
  async initialize() {
    try {
      if (this.logger && typeof this.logger.info === 'function') {
        this.logger.info('🚀 [HappyHour] Initializing cluster timezone scheduler...');
      }
      
      // Stop all background jobs globally
      this.scheduledJobs.forEach(jobGroup => {
        if (jobGroup.startJob) jobGroup.startJob.stop?.();
        if (jobGroup.endJob) jobGroup.endJob.stop?.();
        if (jobGroup.warnJob) jobGroup.warnJob.stop?.();
      });
      this.scheduledJobs.clear();
      this.cronJobs.clear();
      this.configs.clear();

      const activeHH = await this.prisma.happyHour.findMany({
        where: { status: 'active', isActive: true }
      }).catch(() => []);

      if (this.logger && typeof this.logger.info === 'function') {
        this.logger.info(`📋 [HappyHour] Loaded ${activeHH.length} dynamic session configurations.`);
      }

      for (const config of activeHH) {
        this.configs.set(config.id, config);
        this.rescheduleHappyHour(config);
      }
    } catch (err) {
      if (this.logger && typeof this.logger.error === 'function') {
        this.logger.error('[HappyHour] Initialization setup failed', { error: err.message });
      }
    }
  }

  /**
   * 🟢 Trigger Start Sequence
   */
  async triggerStart(config) {
    try {
      if (this.logger && typeof this.logger.warn === 'function') {
        this.logger.warn(`🟢 [HappyHour] Starting active broadcast sequence for Branch ${config.branchId}`);
      }

      const auditService = require('./auditService');
      const cacheService = require('./cacheService');

      if (this.redis && typeof this.redis.setex === 'function') {
        await this.redis.setex(`happyhour:active:${config.branchId}`, 3600, JSON.stringify({
          id: config.id,
          discount: config.discountValue || config.discount || 0,
          endsAt: config.endTime,
          timezone: config.timezone
        })).catch(() => {});
      }

      if (cacheService && typeof cacheService.broadcastInvalidation === 'function') {
        await cacheService.broadcastInvalidation('restaurant_status', config.branchId).catch(() => {});
      }

      if (this.io) {
        this.io.emit('happyhour:start', {
          branchId: config.branchId,
          discount: config.discountValue || config.discount || 0,
          message: `🎉 بدأ Happy Hour! استمتع بخصم ${config.discountValue || config.discount || 0}% الآن.`
        });
      }

      await this.sendNotifications(config, 'STARTED');

      if (auditService && typeof auditService.log === 'function') {
        await auditService.log({
          action: 'HAPPY_HOUR_STARTED',
          entityType: 'Branch',
          entityId: config.branchId,
          severity: 'INFO',
          metadata: { configId: config.id, discount: config.discountValue || config.discount || 0, timezone: config.timezone }
        }).catch(() => {});
      }
    } catch (err) {
      if (this.logger && typeof this.logger.error === 'function') {
        this.logger.error('[HappyHour] Start trigger execution failed', { configId: config.id, error: err.message });
      }
    }
  }

  /**
   * 🔴 Trigger End Sequence
   */
  async triggerEnd(config) {
    try {
      if (this.logger && typeof this.logger.warn === 'function') {
        this.logger.warn(`🔴 [HappyHour] Ending active session broadcast for Branch ${config.branchId}`);
      }

      const cacheService = require('./cacheService');

      if (this.redis && typeof this.redis.del === 'function') {
        await this.redis.del(`happyhour:active:${config.branchId}`).catch(() => {});
      }

      if (cacheService && typeof cacheService.broadcastInvalidation === 'function') {
        await cacheService.broadcastInvalidation('restaurant_status', config.branchId).catch(() => {});
      }

      if (this.io) {
        this.io.emit('happyhour:end', {
          branchId: config.branchId,
          message: '⏰ انتهى وقت الـ Happy Hour. شكراً لزيارتكم!'
        });
      }

      try {
        await this.prisma.happyHourLog.create({
          data: {
            happyHourId: config.id,
            branchId: config.branchId,
            startTime: new Date(),
            endTime: new Date(),
            discount: Number(config.discountValue || config.discount || 0)
          }
        });
      } catch (e) {}

      await this.sendNotifications(config, 'ENDED');
    } catch (err) {
      if (this.logger && typeof this.logger.error === 'function') {
        this.logger.error('[HappyHour] End trigger execution failed', { error: err.message });
      }
    }
  }

  /**
   * ⚠️ Trigger Warning
   */
  async triggerWarning(config) {
    if (this.io) {
      this.io.emit('happyhour:warning', {
        branchId: config.branchId,
        message: '⚠️ تنبيه: ينتهي الـ Happy Hour خلال 15 دقيقة فقط!'
      });
    }
  }

  /**
   * 📢 Send Notifications
   */
  async sendNotifications(config, type) {
    try {
      const preferences = await this.prisma.userBranchPreference.findMany({
        where: { branchId: config.branchId, notifications: true }
      }).catch(() => []);

      const discountVal = config.discountValue || config.discount || 0;

      for (const pref of preferences) {
        await this.prisma.notification.create({
          data: {
            title: type === 'STARTED' ? '🎉 Happy Hour بدأ!' : '⏰ انتهى Happy Hour',
            message: type === 'STARTED' 
              ? `استمتع بخصم ${discountVal}% في فرعنا الآن.` 
              : 'نراكم في المرة القادمة!',
            type: 'HAPPY_HOUR',
            status: 'PENDING',
            metadata: { branchId: config.branchId, discount: discountVal }
          }
        }).catch(() => {});

        if (this.io) {
          this.io.to(`user:${pref.userId}`).emit('notification', {
            type: 'HAPPY_HOUR',
            title: 'Happy Hour Update',
            message: type === 'STARTED' ? 'Started!' : 'Ended!'
          });
        }
      }
    } catch (err) {}
  }

  getMetrics() {
    return metrics;
  }

  async destroy() {
    this.scheduledJobs.forEach(jobGroup => {
      if (jobGroup.startJob) jobGroup.startJob.stop?.();
      if (jobGroup.endJob) jobGroup.endJob.stop?.();
      if (jobGroup.warnJob) jobGroup.warnJob.stop?.();
    });
    this.scheduledJobs.clear();
    this.cronJobs.clear();
  }
}

// Lazy load production singleton instance to prevent background database pooling handles during external unit testing
let serviceSingleton;
const getSingleton = () => {
  if (!serviceSingleton) serviceSingleton = new HappyHourService();
  return serviceSingleton;
};

// Proxied drops support transparent compatibility
const lazyProxy = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'HappyHourService') return HappyHourService;
    if (prop === 'TimezoneCache') return TimezoneCache;
    const inst = getSingleton();
    const val = inst[prop];
    return typeof val === 'function' ? val.bind(inst) : val;
  }
});

module.exports = lazyProxy;
module.exports.HappyHourService = HappyHourService;
module.exports.TimezoneCache = TimezoneCache;
