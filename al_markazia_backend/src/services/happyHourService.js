const cron = require('node-cron');
const nodemailer = require('nodemailer');
const Redis = require('ioredis');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const auditService = require('./auditService');
const cacheService = require('./cacheService');

/**
 * 🎯 Happy Hour Service
 * Manages automated scheduling, notifications, and real-time broadcasts for Happy Hour events.
 * Fully distributed via Redis Pub/Sub.
 */
class HappyHourService {
  constructor() {
    this.instanceId = process.env.INSTANCE_ID || `inst-${Math.random().toString(36).substr(2, 5)}`;
    this.cronJobs = new Map();
    this.configs = new Map();
    this.io = null;

    // 1. Redis for State & Pub/Sub
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
    };
    
    this.redis = new Redis(redisConfig);
    this.pubSub = new Redis({ ...redisConfig, enableReadyCheck: false });

    // 2. Email Transporter
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    this.setupPubSub();
  }

  setIO(io) {
    this.io = io;
  }

  setupPubSub() {
    this.pubSub.on('connect', () => {
      logger.info(`📡 [HappyHourPubSub] Connected: ${this.instanceId}`);
      this.pubSub.subscribe('happyhour:reload');
    });

    this.pubSub.on('message', async (channel, message) => {
      if (channel === 'happyhour:reload') {
        logger.info('🔄 [HappyHour] Reloading configurations across cluster...');
        await this.initialize();
      }
    });

    this.pubSub.on('error', (err) => logger.error('[HappyHourPubSub] Error', { error: err.message }));
  }

  /**
   * 🚀 Bootstrap Service
   */
  async initialize() {
    try {
      logger.info('🚀 [HappyHour] Initializing scheduler...');
      
      // Stop existing jobs
      this.cronJobs.forEach(job => job.stop());
      this.cronJobs.clear();
      this.configs.clear();

      // Load active configurations
      const activeHH = await prisma.happyHour.findMany({
        where: { status: 'active' }
      });

      logger.info(`📋 [HappyHour] Loaded ${activeHH.length} active sessions.`);

      for (const config of activeHH) {
        this.configs.set(config.id, config);
        this.scheduleJob(config);
      }
    } catch (err) {
      logger.error('[HappyHour] Initialization failed', { error: err.message });
    }
  }

  /**
   * ⏰ Schedule Cron Jobs for a Happy Hour Session
   */
  scheduleJob(config) {
    const { id, branchId, dayOfWeek, startTime, endTime, discount } = config;

    // Convert times to Cron format (m h dom mon dow)
    const [startH, startM] = startTime.split(':');
    const [endH, endM] = endTime.split(':');

    // 1. Start Job
    const startCron = `${startM} ${startH} * * ${dayOfWeek}`;
    const startJob = cron.schedule(startCron, () => this.triggerStart(config), { timezone: 'Asia/Amman' });

    // 2. End Job
    const endCron = `${endM} ${endH} * * ${dayOfWeek}`;
    const endJob = cron.schedule(endCron, () => this.triggerEnd(config), { timezone: 'Asia/Amman' });

    // 3. Warning Job (15 mins before end)
    let warnM = parseInt(endM) - 15;
    let warnH = parseInt(endH);
    if (warnM < 0) {
      warnM += 60;
      warnH -= 1;
    }
    const warnCron = `${warnM} ${warnH} * * ${dayOfWeek}`;
    const warnJob = cron.schedule(warnCron, () => this.triggerWarning(config), { timezone: 'Asia/Amman' });

    this.cronJobs.set(`${id}:start`, startJob);
    this.cronJobs.set(`${id}:end`, endJob);
    this.cronJobs.set(`${id}:warn`, warnJob);

    logger.debug(`⏰ Scheduled HH ${id} for Branch ${branchId} [${startTime} - ${endTime}]`);
  }

  /**
   * 🟢 Trigger Start Sequence
   */
  async triggerStart(config) {
    try {
      logger.warn(`🟢 [HappyHour] Starting session for Branch ${config.branchId}`);

      // 1. Update Global State (Redis)
      await this.redis.setex(`happyhour:active:${config.branchId}`, 3600, JSON.stringify({
        id: config.id,
        discount: config.discount,
        endsAt: config.endTime
      }));

      // 2. Invalidate Caches (So users see the discount)
      await cacheService.broadcastInvalidation('restaurant_status', config.branchId);

      // 3. Broadcast Socket Event
      if (this.io) {
        this.io.emit('happyhour:start', {
          branchId: config.branchId,
          discount: config.discount,
          message: `🎉 بدأ Happy Hour! استمتع بخصم ${config.discount}% الآن.`
        });
      }

      // 4. Send Notifications
      await this.sendNotifications(config, 'STARTED');

      // 5. Audit
      await auditService.log({
        action: 'HAPPY_HOUR_STARTED',
        entityType: 'Branch',
        entityId: config.branchId,
        severity: 'INFO',
        metadata: { configId: config.id, discount: config.discount }
      });
    } catch (err) {
      logger.error('[HappyHour] Start trigger failed', { configId: config.id, error: err.message });
    }
  }

  /**
   * 🔴 Trigger End Sequence
   */
  async triggerEnd(config) {
    try {
      logger.warn(`🔴 [HappyHour] Ending session for Branch ${config.branchId}`);

      // 1. Cleanup State
      await this.redis.del(`happyhour:active:${config.branchId}`);
      await cacheService.broadcastInvalidation('restaurant_status', config.branchId);

      // 2. Broadcast
      if (this.io) {
        this.io.emit('happyhour:end', {
          branchId: config.branchId,
          message: '⏰ انتهى وقت الـ Happy Hour. شكراً لزيارتكم!'
        });
      }

      // 3. Log to DB
      await prisma.happyHourLog.create({
        data: {
          happyHourId: config.id,
          branchId: config.branchId,
          startTime: new Date(), // Approximate
          endTime: new Date(),
          discount: config.discount
        }
      });

      await this.sendNotifications(config, 'ENDED');
    } catch (err) {
      logger.error('[HappyHour] End trigger failed', { error: err.message });
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
   * 📢 Dispatch Multi-Channel Notifications
   */
  async sendNotifications(config, type) {
    try {
      const preferences = await prisma.userBranchPreference.findMany({
        where: { branchId: config.branchId, notifications: true }
      });

      for (const pref of preferences) {
        // Here we would integrate with Push (FCM), SMS, or Email.
        // For this demo/task, we'll focus on Socket and Internal Notifications.
        
        await prisma.notification.create({
          data: {
            customerPhone: null, // If linked to customer
            title: type === 'STARTED' ? '🎉 Happy Hour بدأ!' : '⏰ انتهى Happy Hour',
            message: type === 'STARTED' 
              ? `استمتع بخصم ${config.discount}% في فرعنا الآن.` 
              : 'نراكم في المرة القادمة!',
            type: 'HAPPY_HOUR',
            status: 'PENDING',
            metadata: { branchId: config.branchId, discount: config.discount }
          }
        });

        if (this.io) {
          this.io.to(`user:${pref.userId}`).emit('notification', {
            type: 'HAPPY_HOUR',
            title: 'Happy Hour Update',
            message: type === 'STARTED' ? 'Started!' : 'Ended!'
          });
        }
      }
    } catch (err) {
      logger.error('[HappyHour] Notification dispatch failed', { error: err.message });
    }
  }

  /**
   * 🧹 Cleanup
   */
  async destroy() {
    this.cronJobs.forEach(job => job.stop());
    await this.redis.quit();
    await this.pubSub.quit();
  }
}

module.exports = new HappyHourService();
