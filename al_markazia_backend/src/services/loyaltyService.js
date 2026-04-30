const prisma = require('../lib/prisma');
const { DateTime } = require('luxon');
const logger = require('../utils/logger');
const eventBus = require('../events/eventBus');

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
    
    return {
      ...config,
      happyHourStatus: status
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
    const now = DateTime.now().setZone(DEFAULT_TIMEZONE); // Jordan Time
    const today = now.toISODate();

    const start = DateTime.fromISO(`${today}T${config.happyHourStart}`, { zone: DEFAULT_TIMEZONE });
    const end = DateTime.fromISO(`${today}T${config.happyHourEnd}`, { zone: DEFAULT_TIMEZONE });

    if (now >= start && now <= end) {
      return {
        isActive: true,
        status: 'ACTIVE',
        remainingSeconds: Math.floor(end.diff(now, 'seconds').seconds)
      };
    } else if (now < start) {
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
      'referralPoints', 'socialSharePoints', 'happyHourMultiplier', 'cancellationCompensationRate'
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

      // 📮 [RESILIENCE-FIX] Outbox for Audit Trail / External Sync
      const outboxService = require('./outboxService');
      await outboxService.enqueue('loyalty.config_updated', {
        configId: config.id,
        changes: sanitized
      }, tx);

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

      // 2. Apply Happy Hour Multiplier if active
      if (config.isHappyHourEnabled) {
        const { DEFAULT_TIMEZONE } = require('../config/constants');
        const now = DateTime.now().setZone(DEFAULT_TIMEZONE);
        const currentTime = now.hour * 60 + now.minute;
        
        const [startH, startM] = config.happyHourStart.split(':').map(Number);
        const [endH, endM] = config.happyHourEnd.split(':').map(Number);
        const startTime = startH * 60 + startM;
        const endTime = endH * 60 + endM;

        if (currentTime >= startTime && currentTime <= endTime) {
          multiplier *= config.happyHourMultiplier;
          logger.info(`[Loyalty] Happy Hour active! Applying ${config.happyHourMultiplier}x multiplier`);
        }
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
      const updatedCustomer = await db.customer.update({
        where: { id: order.customerId },
        data: {
          points: { increment: pointsEarned },
          totalOrders: { increment: 1 }
        }
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
      logger.info(`Customer ${customerId} upgraded to ${newTier} tier`);
      // TODO: Send notification to customer about tier upgrade
    }
  }

  /**
   * Award Points for Engagement (Review, Referral, etc.)
   */
  async awardEngagementPoints(customerId, type) {
    const config = await this.getConfig();
    let points = 0;

    switch (type) {
      case 'REVIEW': points = config.reviewPoints; break;
      case 'REFERRAL': points = config.referralPoints; break;
      case 'SOCIAL_SHARE': points = config.socialSharePoints; break;
    }

    if (points > 0) {
      await prisma.customer.update({
        where: { id: customerId },
        data: { points: { increment: points } }
      });
      logger.info(`Awarded ${points} engagement points to customer ${customerId} for ${type}`);
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
      const amount = Math.max(50, Math.floor(Number(order.total) * config.cancellationCompensationRate * config.pointsPerJod));

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
}

module.exports = new LoyaltyService();
