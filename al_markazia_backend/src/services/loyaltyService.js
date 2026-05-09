const { DateTime } = require('luxon');

/**
 * 🎁 Loyalty Service
 * Handles point accrual, tier management, and rewards.
 */
class LoyaltyService {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
  }

  /**
   * Get Current Loyalty Configuration
   */
  async getConfig() {
    let config = await this.prisma.loyaltyConfig.findFirst();
    if (!config) {
      config = await this.prisma.loyaltyConfig.create({ data: {} });
    }

    // 🕒 Calculate Happy Hour Status
    const status = this._calculateHappyHourStatus(config);
    
    const { DEFAULT_TIMEZONE } = require('../config/constants');
    const now = DateTime.now().setZone(DEFAULT_TIMEZONE);

    return {
      ...config,
      happyHourStatus: status,
      serverTime: now.toFormat('HH:mm'),
      timezone: DEFAULT_TIMEZONE
    };
  }

  /**
   * 🕒 Internal Helper: Calculate if Happy Hour is currently active and time remaining
   */
  _calculateHappyHourStatus(config) {
    if (!config.isHappyHourEnabled) {
      return { isActive: false, status: 'DISABLED', remainingSeconds: 0 };
    }

    const { DEFAULT_TIMEZONE } = require('../config/constants');
    const now = DateTime.now().setZone(DEFAULT_TIMEZONE);
    
    const isActive = this._isWithinHappyHour(config, now.toJSDate());
    
    if (isActive) {
      // Calculate remaining seconds
      const today = now.toISODate();
      let end = DateTime.fromISO(`${today}T${config.happyHourEnd}`, { zone: DEFAULT_TIMEZONE });
      
      if (now > end) {
        end = end.plus({ days: 1 });
      }

      return {
        isActive: true,
        status: 'ACTIVE',
        remainingSeconds: Math.max(0, Math.floor(end.diff(now, 'seconds').seconds))
      };
    } else {
      const today = now.toISODate();
      const start = DateTime.fromISO(`${today}T${config.happyHourStart}`, { zone: DEFAULT_TIMEZONE });
      
      if (now < start) {
        return {
          isActive: false,
          status: 'PENDING',
          remainingSeconds: Math.floor(start.diff(now, 'seconds').seconds)
        };
      } else {
        return {
          isActive: false,
          status: 'EXPIRED',
          remainingSeconds: 0
        };
      }
    }
  }

  /**
   * 🛡️ Core Time Guard
   */
  _isWithinHappyHour(config, timestamp) {
    if (!config || !config.isHappyHourEnabled) return false;
    
    const { DEFAULT_TIMEZONE } = require('../config/constants');
    const timeToCheck = DateTime.fromJSDate(new Date(timestamp)).setZone(DEFAULT_TIMEZONE);
    
    const nowMinutes = this.container.financialService.getMinutesSinceMidnight(timeToCheck);
    const startMinutes = this.container.financialService.parseTimeToMinutes(config.happyHourStart);
    const endMinutes = this.container.financialService.parseTimeToMinutes(config.happyHourEnd);

    if (startMinutes > endMinutes) {
      return nowMinutes >= startMinutes || nowMinutes < endMinutes;
    }

    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }

  /**
   * 🤖 Automated Maintenance
   */
  async checkAndAutoDisable() {
    const config = await this.prisma.loyaltyConfig.findFirst();
    if (!config || !config.isHappyHourEnabled) return null;

    const status = this._calculateHappyHourStatus(config);
    
    if (status.status === 'EXPIRED') {
      const updated = await this.prisma.loyaltyConfig.update({
        where: { id: config.id },
        data: { isHappyHourEnabled: false }
      });
      return { id: config.id, disabled: true };
    }
    return null;
  }

  /**
   * 🚀 Immediate Activation
   */
  async startNow() {
    const config = await this.getConfig();
    const now = DateTime.now().setZone('Asia/Amman');
    
    const startTime = now.toFormat('HH:mm');
    const endTime = now.plus({ hours: 2 }).toFormat('HH:mm');

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.loyaltyConfig.update({
        where: { id: config.id },
        data: {
          isHappyHourEnabled: true,
          happyHourStart: startTime,
          happyHourEnd: endTime
        }
      }, { timeout: 15000 });

      await this.container.outboxService.enqueue('loyalty.happy_hour_activated', {
        title: '🎁 بدأت سـاعـة الـسـعـادة!',
        message: `تم تفعيل مضاعفة النقاط x${result.happyHourMultiplier} الآن! اطلب واستمتع بمكافآت إضافية.`,
        multiplier: result.happyHourMultiplier
      }, tx);

      return result;
    });

    return {
      ...updated,
      happyHourStatus: this._calculateHappyHourStatus(updated)
    };
  }

  /**
   * 🛑 Manual Deactivation
   */
  async stopNow() {
    const config = await this.getConfig();
    
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.loyaltyConfig.update({
        where: { id: config.id },
        data: { isHappyHourEnabled: false }
      }, { timeout: 15000 });

      await this.container.outboxService.enqueue('system.broadcast', {
        title: '🏁 انتهت ساعة السعادة',
        message: 'انتهت فترة مضاعفة النقاط حالياً، شكراً لتواجدكم معنا. انتظرونا في فترات قادمة!',
      }, tx);

      return result;
    });

    return {
      ...updated,
      happyHourStatus: this._calculateHappyHourStatus(updated)
    };
  }

  /**
   * Update Loyalty Configuration
   */
  async updateConfig(data) {
    const sanitized = {};
    const numFields = [
      'pointsPerJod', 'tierGoldMinOrders', 'tierPlatinumMinOrders', 
      'pointsMultiplierGold', 'pointsMultiplierPlatinum', 'reviewPoints', 
      'referralPoints', 'socialSharePoints', 'happyHourMultiplier', 'cancellationCompensationRate',
      'pointsToJodRate', 'minPointsToRedeem'
    ];
    
    numFields.forEach(field => {
      if (data[field] !== undefined) {
        sanitized[field] = parseFloat(data[field]);
      }
    });

    if (data.isHappyHourEnabled !== undefined) {
      sanitized.isHappyHourEnabled = String(data.isHappyHourEnabled) === 'true' || data.isHappyHourEnabled === true;
    }

    if (data.happyHourStart) sanitized.happyHourStart = data.happyHourStart;
    if (data.happyHourEnd) sanitized.happyHourEnd = data.happyHourEnd;
    const config = await this.getConfig();

    return await this.prisma.$transaction(async (tx) => {
      const result = await tx.loyaltyConfig.update({
        where: { id: config.id },
        data: sanitized
      }, { timeout: 15000 });

      await this.container.auditService.logWithDiff({
        userId: 'admin-system',
        userRole: 'admin',
        action: 'LOYALTY_CONFIG_UPDATE',
        entityType: 'LoyaltyConfig',
        entityId: config.id.toString(),
        severity: 'WARN'
      }, config, result);

      return result;
    });
  }

  /**
   * Award Points for Order Completion
   */
  async awardPointsForOrder(orderIdOrOrder, tx = null) {
    const db = tx || this.prisma;
    try {
      let order;
      if (typeof orderIdOrOrder === 'object') {
        order = orderIdOrOrder;
      } else {
        order = await db.order.findUnique({
          where: { id: orderIdOrOrder },
          include: { customer: true }
        });
      }

      const orderId = order?.id;

      if (!order || !order.customerId || order.status !== 'delivered') {
        this.logger.info(`[Loyalty] Skipping points for order ${orderId} (Status: ${order?.status}, HasCustomer: ${!!order?.customerId})`);
        return 0;
      }

      // 🛡️ Idempotency check: Atomic update to prevent double-awarding
      const claimResult = await db.order.updateMany({
        where: { id: orderId, pointsAwarded: false },
        data: { pointsAwarded: true }
      });

      if (claimResult.count === 0) {
        this.logger.info(`[Loyalty] Points already awarded or claim failed for order ${orderId}`);
        return 0;
      }

      const config = await this.getConfig();
      const customer = order.customer;

      let multiplier = 1.0;
      if (customer.tier === 'GOLD') multiplier = config.pointsMultiplierGold;
      if (customer.tier === 'PLATINUM') multiplier = config.pointsMultiplierPlatinum;

      if (this._isWithinHappyHour(config, order.createdAt)) {
        multiplier *= config.happyHourMultiplier;
        this.logger.info(`[Loyalty] Happy Hour active for order #${order.orderNumber}! Applying ${config.happyHourMultiplier}x multiplier`);
      }

      const netSubtotal = Number(order.subtotal) - Number(order.discount || 0);
      const pointsEarned = Math.floor(Math.max(0, netSubtotal) * config.pointsPerJod * multiplier);

      if (pointsEarned <= 0) return 0;

      const updatedCustomer = await this.container.financialService.awardPoints(order.customerId, pointsEarned, 'ORDER', db);
      
      await db.customer.update({
        where: { id: order.customerId },
        data: { totalOrders: { increment: 1 } }
      });
      
      await this.evaluateTierUpgrade(updatedCustomer.id, config, db);
      return pointsEarned;
    } catch (err) {
      this.logger.error('Failed to award loyalty points', { error: err.message, orderId });
      throw err;
    }
  }

  /**
   * Evaluate and Upgrade Customer Tier
   */
  async evaluateTierUpgrade(customerId, config, tx = null) {
    const db = tx || this.prisma;
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) return;

    let newTier = 'SILVER';
    if (customer.totalOrders >= config.tierPlatinumMinOrders) {
      newTier = 'PLATINUM';
    } else if (customer.totalOrders >= config.tierGoldMinOrders) {
      newTier = 'GOLD';
    }

    if (newTier !== customer.tier) {
      await db.customer.update({
        where: { id: customerId },
        data: { tier: newTier }
      });
      
      const { SOCKET_EVENTS } = require('../shared/socketEvents');
      const io = require('../socket').getIO();

      const titles = { 'GOLD': '🟡 مبروك! وصلت للمستوى الذهبي', 'PLATINUM': '💎 مبروك! وصلت للمستوى البلاتيني' };
      const msgs = { 
        'GOLD': `لقد أصبحت الآن عضواً ذهبياً! ستصلك نقاط إضافية x${config.pointsMultiplierGold} على كل طلب.`, 
        'PLATINUM': `لقد وصلت للقمة! أنت الآن عضو بلاتيني بمضاعف نقاط x${config.pointsMultiplierPlatinum}.` 
      };

      if (titles[newTier]) {
        await this.container.notificationService.sendToCustomer(customer.phone, {
          title: titles[newTier],
          message: msgs[newTier],
          type: 'TIER_UPGRADE',
          metadata: { newTier }
        });

        if (io) {
          io.to(`room:customer:${customerId}`).emit(SOCKET_EVENTS.SYSTEM_ALERT, {
            type: 'TIER_UPGRADE',
            title: titles[newTier],
            message: msgs[newTier],
            tier: newTier
          });
        }
      }
    }
  }

  async awardEngagementPoints(customerId, type, metadata = {}) {
    const config = await this.getConfig();
    let points = 0;
    let reason = '';

    switch (type) {
      case 'REVIEW': points = config.reviewPoints; reason = 'مكافأة تقييم وجبة'; break;
      case 'REFERRAL': points = config.referralPoints; reason = 'مكافأة دعوة صديق'; break;
      case 'SOCIAL_SHARE': points = config.socialSharePoints; reason = 'مكافأة مشاركة منتج'; break;
      default: throw new Error('نوع المكافأة غير معروف');
    }

    if (points > 0) {
      await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id: customerId } }, { timeout: 15000 });
        if (!customer) throw new Error('العميل غير موجود');

        const updatedCustomer = await tx.customer.update({
          where: { id: customerId },
          data: { points: { increment: points } }
        });

        await tx.customerAuditLog.create({
          data: {
            customerId,
            eventType: 'LOYALTY_REWARD',
            eventAction: type,
            changedBy: customer.uuid,
            changedByRole: 'customer',
            reason: reason,
            previousData: JSON.stringify({ points: customer.points }),
            newData: JSON.stringify({ points: updatedCustomer.points }),
            diff: `+${points} points`,
            actionCategory: 'LOYALTY',
            requestSource: metadata.source || 'APP'
          }
        });
      });
    }
  }

  async compensatePointsForCancellation(orderId, reason = 'تأخير من المطعم') {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: true }
      });
      if (!order || !order.customerId) return null;
      const config = await this.getConfig();
      const amount = Math.max(config.minCompensationPoints || 50, Math.floor(Number(order.total) * (config.cancellationCompensationRate || 0.05) * config.pointsPerJod));
      await this.prisma.customer.update({
        where: { id: order.customerId },
        data: { points: { increment: amount } }
      });
      await this.container.auditService.log({
        userId: order.customer.uuid,
        userRole: 'customer',
        action: 'LOYALTY_COMPENSATION',
        metadata: { orderId, amount, reason, orderNumber: order.orderNumber }
      });
      return amount;
    } catch (err) {
      this.logger.error('[Loyalty] Compensation failed', { orderId, error: err.message });
      return null;
    }
  }

  async getAllRewards() { return await this.prisma.rewardItem.findMany({ orderBy: { pointsCost: 'asc' } }); }
  async getActiveRewards() { return await this.prisma.rewardItem.findMany({ where: { isActive: true }, orderBy: { pointsCost: 'asc' } }); }

  async createReward(data) {
    return await this.prisma.rewardItem.create({
      data: {
        title: data.title, titleEn: data.titleEn, description: data.description, descriptionEn: data.descriptionEn,
        pointsCost: parseInt(data.pointsCost), imageUrl: data.imageUrl, isActive: data.isActive !== undefined ? data.isActive : true
      }
    });
  }

  async updateReward(id, data) {
    return await this.prisma.rewardItem.update({
      where: { id },
      data: { ...data, pointsCost: data.pointsCost ? parseInt(data.pointsCost) : undefined }
    });
  }

  async deleteReward(id) { return await this.prisma.rewardItem.delete({ where: { id } }); }

  async claimReward(customerId, rewardId) {
    return await this.prisma.$transaction(async (tx) => {
      const reward = await tx.rewardItem.findUnique({ where: { id: rewardId } }, { timeout: 15000 });
      if (!reward || !reward.isActive) throw new Error('المكافأة غير متاحة حالياً');
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (customer.points < reward.pointsCost) throw new Error('رصيد النقاط غير كافٍ');
      const code = 'RW-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      await tx.customer.update({ where: { id: customerId }, data: { points: { decrement: reward.pointsCost } } });
      await tx.customerReward.create({
        data: {
          customerId: customerId,
          rewardItemId: reward.id,
          code: code,
          expiresAt: new Date(Date.now() + (await this.getConfig()).rewardExpiryDays * 24 * 60 * 60 * 1000) 
        },
        include: { rewardItem: true }
      });
      return { success: true, code };
    });
  }

  async getCustomerRewards(customerId) {
    return await this.prisma.customerReward.findMany({
      where: { customerId: customerId }, include: { rewardItem: true }, orderBy: { createdAt: 'desc' }
    });
  }
}

// --- 🛡️ Backward Compatibility ---
const getContainer = () => require('../lib/container');
const proxy = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'LoyaltyService') return LoyaltyService;
    const service = getContainer().loyaltyService;
    const val = service[prop];
    return typeof val === 'function' ? val.bind(service) : val;
  }
});

module.exports = proxy;
module.exports.LoyaltyService = LoyaltyService;
