const prisma = require('../lib/prisma');
const { DateTime } = require('luxon');
const logger = require('../utils/logger');
const eventBus = require('../events/eventBus');
const financialService = require('./financialService');
const auditService = require('./auditService');

/**
 * 🎁 Loyalty Service
 * Handles point accrual, tier management, and rewards.
 */
class LoyaltyService {
  /**
   * Get Current Loyalty Configuration
   */
  async getConfig() {
    let config = await prisma.loyaltyConfig.findFirst();
    if (!config) {
      config = await prisma.loyaltyConfig.create({ data: {} });
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
        // If we are in a midnight-crossing window and now is before midnight (e.g. 23:30)
        // end is 01:30 today (past), so we need 01:30 tomorrow.
        end = end.plus({ days: 1 });
      }

      return {
        isActive: true,
        status: 'ACTIVE',
        remainingSeconds: Math.max(0, Math.floor(end.diff(now, 'seconds').seconds))
      };
    } else {
      // Check if it's pending (in the future) or expired (in the past)
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
   * 🛡️ Core Time Guard: Handles midnight crossing using MSM (Minutes Since Midnight).
   */
  _isWithinHappyHour(config, timestamp) {
    if (!config || !config.isHappyHourEnabled) return false;
    
    const { DEFAULT_TIMEZONE } = require('../config/constants');
    const timeToCheck = DateTime.fromJSDate(new Date(timestamp)).setZone(DEFAULT_TIMEZONE);
    
    const nowMinutes = financialService.getMinutesSinceMidnight(timeToCheck);
    const startMinutes = financialService.parseTimeToMinutes(config.happyHourStart);
    const endMinutes = financialService.parseTimeToMinutes(config.happyHourEnd);

    if (startMinutes > endMinutes) {
      // Midnight crossing case
      return nowMinutes >= startMinutes || nowMinutes < endMinutes;
    }

    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }

  /**
   * 🤖 Automated Maintenance: Checks if Happy Hour should be disabled after end time
   */
  async checkAndAutoDisable() {
    const config = await prisma.loyaltyConfig.findFirst();
    if (!config || !config.isHappyHourEnabled) return null;

    const status = this._calculateHappyHourStatus(config);
    
    // If it was enabled but the time window has passed, we can choose to auto-disable 
    // OR just let it stay enabled for the next day. 
    // The user asked to "تغلق تلقائياً وعند انتهاء الوقت فعلياً تغلق هذه الخاصية".
    if (status.status === 'EXPIRED') {
      const updated = await prisma.loyaltyConfig.update({
        where: { id: config.id },
        data: { isHappyHourEnabled: false }
      });
      return { id: config.id, disabled: true };
    }
    return null;
  }

  /**
   * 🚀 Immediate Activation: Starts Happy Hour NOW and notifies all users
   */
  async startNow() {
    const config = await this.getConfig();
    const now = DateTime.now().setZone('Asia/Amman');
    
    // Set start to now and end to 2 hours from now (default window)
    const startTime = now.toFormat('HH:mm');
    const endTime = now.plus({ hours: 2 }).toFormat('HH:mm');

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.loyaltyConfig.update({
        where: { id: config.id },
        data: {
          isHappyHourEnabled: true,
          happyHourStart: startTime,
          happyHourEnd: endTime
        }
      });

      // 📮 [RESILIENCE-FIX] Transactional Outbox Enqueue
      const outboxService = require('./outboxService');
      await outboxService.enqueue('loyalty.happy_hour_activated', {
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
   * 🛑 Manual Deactivation: Stops Happy Hour immediately
   */
  async stopNow() {
    const config = await this.getConfig();
    
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.loyaltyConfig.update({
        where: { id: config.id },
        data: { isHappyHourEnabled: false }
      });

      // 📮 [RESILIENCE-FIX] Transactional Outbox Enqueue
      const outboxService = require('./outboxService');
      await outboxService.enqueue('system.broadcast', {
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
    // 🛡️ Data Sanitization & Type Conversion
    const sanitized = {};
    
    // Numeric fields
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

    // Boolean fields
    if (data.isHappyHourEnabled !== undefined) {
      sanitized.isHappyHourEnabled = String(data.isHappyHourEnabled) === 'true' || data.isHappyHourEnabled === true;
    }

    // String fields
    if (data.happyHourStart) sanitized.happyHourStart = data.happyHourStart;
    if (data.happyHourEnd) sanitized.happyHourEnd = data.happyHourEnd;
    const config = await this.getConfig();

    return await prisma.$transaction(async (tx) => {
      const result = await tx.loyaltyConfig.update({
        where: { id: config.id },
        data: sanitized
      });

      // 🛡️ [SEC-FIX] Audit Trail with Diff
      await auditService.logWithDiff({
        userId: 'admin-system', // Replace with actual admin UUID if available in ctx
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
    const db = tx || prisma;
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
        logger.info(`[Loyalty] Skipping points for order ${orderId} (Status: ${order?.status}, HasCustomer: ${!!order?.customerId})`);
        return 0;
      }

      const config = await this.getConfig();
      const customer = order.customer;

      // 1. Calculate Base Points
      let multiplier = 1.0;
      if (customer.tier === 'GOLD') multiplier = config.pointsMultiplierGold;
      if (customer.tier === 'PLATINUM') multiplier = config.pointsMultiplierPlatinum;

      // 2. Apply Happy Hour Multiplier if order was placed during window
      if (this._isWithinHappyHour(config, order.createdAt)) {
        multiplier *= config.happyHourMultiplier;
        logger.info(`[Loyalty] Happy Hour active for order #${order.orderNumber} (Placed at: ${order.createdAt})! Applying ${config.happyHourMultiplier}x multiplier`);
      }

      const pointsEarned = Math.floor(Number(order.subtotal) * config.pointsPerJod * multiplier);

      logger.info(`[Loyalty] Calculating points for Order #${order.orderNumber}:`, {
        subtotal: order.subtotal,
        pointsPerJod: config.pointsPerJod,
        multiplier,
        calculatedPoints: pointsEarned,
        targetCustomerId: order.customerId
      });

      if (pointsEarned <= 0) {
        logger.warn(`[Loyalty] Zero points calculated for order ${orderId}`, { subtotal: order.subtotal, multiplier });
        return 0;
      }

      // 3. Update Customer Points & Total Orders
      const updatedCustomer = await financialService.awardPoints(order.customerId, pointsEarned, 'ORDER', db);
      
      await db.customer.update({
        where: { id: order.customerId },
        data: { totalOrders: { increment: 1 } }
      });
      
      logger.info(`[Loyalty] DB Update Success. Customer ${updatedCustomer.id} (UUID: ${updatedCustomer.uuid}) new balance: ${updatedCustomer.points}`);

      // 4. Evaluate Tier Upgrade
      await this.evaluateTierUpgrade(updatedCustomer.id, config, db);

      logger.info(`[Loyalty] Awarded ${pointsEarned} points to customer ${customer.uuid} for order #${order.orderNumber}`);
      return pointsEarned;
    } catch (err) {
      logger.error('Failed to award loyalty points', { error: err.message, orderId });
      throw err; // Re-throw to ensure OrderService knows it failed
    }
  }

  /**
   * Evaluate and Upgrade Customer Tier
   */
  async evaluateTierUpgrade(customerId, config, tx = null) {
    const db = tx || prisma;
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
      
      logger.info(`🏆 Customer ${customerId} upgraded to ${newTier} tier`);
      
      // 📮 [WOW-FACTOR] Notify User via Sockets & Push
      const notificationService = require('./notificationService');
      const { SOCKET_EVENTS } = require('../shared/socketEvents');
      const io = require('../socket').getIO();

      const titles = { 'GOLD': '🟡 مبروك! وصلت للمستوى الذهبي', 'PLATINUM': '💎 مبروك! وصلت للمستوى البلاتيني' };
      const msgs = { 
        'GOLD': `لقد أصبحت الآن عضواً ذهبياً! ستصلك نقاط إضافية x${config.pointsMultiplierGold} على كل طلب.`, 
        'PLATINUM': `لقد وصلت للقمة! أنت الآن عضو بلاتيني بمضاعف نقاط x${config.pointsMultiplierPlatinum}.` 
      };

      if (titles[newTier]) {
        await notificationService.sendToCustomer(customer.phone, {
          title: titles[newTier],
          message: msgs[newTier],
          type: 'TIER_UPGRADE',
          metadata: { newTier }
        });

        // Live Socket Flash
        io.to(`room:customer:${customerId}`).emit(SOCKET_EVENTS.SYSTEM_ALERT, {
          type: 'TIER_UPGRADE',
          title: titles[newTier],
          message: msgs[newTier],
          tier: newTier
        });
      }
    }
  }

  /**
   * Award Points for Engagement (Review, Referral, etc.)
   * 🛡️ Secured with atomic transactions and full audit trail
   */
  async awardEngagementPoints(customerId, type, metadata = {}) {
    const config = await this.getConfig();
    let points = 0;
    let reason = '';

    switch (type) {
      case 'REVIEW': 
        points = config.reviewPoints; 
        reason = 'مكافأة تقييم وجبة';
        break;
      case 'REFERRAL': 
        points = config.referralPoints; 
        reason = 'مكافأة دعوة صديق';
        break;
      case 'SOCIAL_SHARE': 
        points = config.socialSharePoints; 
        reason = 'مكافأة مشاركة منتج';
        break;
      default:
        throw new Error('نوع المكافأة غير معروف');
    }

    if (points > 0) {
      await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id: customerId } });
        if (!customer) throw new Error('العميل غير موجود');

        const updatedCustomer = await tx.customer.update({
          where: { id: customerId },
          data: { points: { increment: points } }
        });

        // 📝 Secure Audit Trail
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

        logger.info(`[Loyalty Security] Transactional reward: +${points} points to customer ${customerId} for ${type}`);
      });
    }
  }

  /**
   * ⚠️ Compensate Customer with Points for Cancellation
   * Triggered when restaurant cancels due to delay or error.
   */
  async compensatePointsForCancellation(orderId, reason = 'تأخير من المطعم') {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: true }
      });

      if (!order || !order.customerId) return null;

      // Compensation is based on config rate (e.g. 5%) of order total or at least 50 points
      const config = await this.getConfig();
      const amount = Math.max(config.minCompensationPoints, Math.floor(Number(order.total) * config.cancellationCompensationRate * config.pointsPerJod));

      await prisma.customer.update({
        where: { id: order.customerId },
        data: { points: { increment: amount } }
      });

      // 📝 Audit Trail
      await prisma.systemAuditLog.create({
        data: {
          userId: order.customer.uuid,
          userRole: 'customer',
          action: 'LOYALTY_COMPENSATION',
          metadata: { 
            orderId, 
            amount, 
            reason, 
            orderNumber: order.orderNumber 
          }
        }
      });

      logger.info(`[Loyalty] Compensated customer ${order.customerId} with ${amount} points for order cancellation (#${order.orderNumber})`);
      
      return amount;
    } catch (err) {
      logger.error('[Loyalty] Compensation failed', { orderId, error: err.message });
      return null;
    }
  }
  // --------------------------------------------------------------------------
  // 🛒 REWARDS STORE CORE LOGIC
  // --------------------------------------------------------------------------

  async getAllRewards() {
    return await prisma.rewardItem.findMany({
      orderBy: { pointsCost: 'asc' }
    });
  }

  async getActiveRewards() {
    return await prisma.rewardItem.findMany({
      where: { isActive: true },
      orderBy: { pointsCost: 'asc' }
    });
  }

  async createReward(data) {
    return await prisma.rewardItem.create({
      data: {
        title: data.title,
        titleEn: data.titleEn,
        description: data.description,
        descriptionEn: data.descriptionEn,
        pointsCost: parseInt(data.pointsCost),
        imageUrl: data.imageUrl,
        isActive: data.isActive !== undefined ? data.isActive : true
      }
    });
  }

  async updateReward(id, data) {
    const updateData = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.titleEn !== undefined) updateData.titleEn = data.titleEn;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.descriptionEn !== undefined) updateData.descriptionEn = data.descriptionEn;
    if (data.pointsCost !== undefined) updateData.pointsCost = parseInt(data.pointsCost);
    if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    return await prisma.rewardItem.update({
      where: { id },
      data: updateData
    });
  }

  async deleteReward(id) {
    return await prisma.rewardItem.delete({
      where: { id }
    });
  }

  /**
   * 🛍️ Claim a Reward Item using Points
   */
  async claimReward(customerId, rewardId) {
    return await prisma.$transaction(async (tx) => {
      const reward = await tx.rewardItem.findUnique({ where: { id: rewardId } });
      if (!reward || !reward.isActive) {
        throw new Error('المكافأة غير متاحة حالياً');
      }

      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (customer.points < reward.pointsCost) {
        throw new Error('رصيد النقاط غير كافٍ لاستبدال هذه المكافأة');
      }

      // Generate a unique short code for the reward (e.g. RW-123456)
      const code = 'RW-' + Math.random().toString(36).substring(2, 8).toUpperCase();

      // Deduct points
      await tx.customer.update({
        where: { id: customerId },
        data: { points: { decrement: reward.pointsCost } }
      });

      // Audit Log
      await tx.customerAuditLog.create({
        data: {
          customerId: customerId,
          action: 'REWARD_CLAIMED',
          oldValue: customer.points,
          newValue: customer.points - reward.pointsCost,
          actorId: customerId,
          reason: `استبدال النقاط بمكافأة: ${reward.title}`,
          metadata: { rewardId: reward.id, pointsDeducted: reward.pointsCost }
        }
      });

      // Create Customer Reward
      const customerReward = await tx.customerReward.create({
        data: {
          customerId: customerId,
          rewardItemId: reward.id,
          code: code,
          expiresAt: new Date(Date.now() + (await this.getConfig()).rewardExpiryDays * 24 * 60 * 60 * 1000) 
        },
        include: { rewardItem: true }
      });

      return customerReward;
    });
  }

  /**
   * 📦 Get Customer's Claimed Rewards
   */
  async getCustomerRewards(customerId) {
    return await prisma.customerReward.findMany({
      where: { customerId: customerId },
      include: { rewardItem: true },
      orderBy: { createdAt: 'desc' }
    });
  }
}

module.exports = new LoyaltyService();
