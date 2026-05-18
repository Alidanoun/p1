const { v4: uuidv4 } = require('uuid');
const { DateTime } = require('luxon');
const Decimal = require('decimal.js');
const financialConfig = require('../config/financial');
const { trackLoyaltyCalculation, trackNegativeBalancePrevented } = require('../utils/metrics');
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
   * 🛡️ Core Time Guard (Timezone Safe Integration)
   */
  _isWithinHappyHour(config, timestamp, appliedTimezone = null) {
    if (!config || !config.isHappyHourEnabled) return false;
    
    let targetTz = appliedTimezone;
    if (!targetTz) {
      try {
        const branchId = require('../utils/context').getBranchId();
        targetTz = branchId ? 'Africa/Cairo' : require('../config/constants').DEFAULT_TIMEZONE;
      } catch (e) {
        targetTz = require('../config/constants').DEFAULT_TIMEZONE;
      }
    }
    
    const timeToCheck = DateTime.fromJSDate(new Date(timestamp)).setZone(targetTz || 'Africa/Cairo');
    
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

      await this.container.outboxService.enqueue(tx, {
        type: 'loyalty.happy_hour_activated',
        aggregateId: result.id,
        aggregateType: 'LoyaltyConfig',
        payload: {
          title: '🎁 بدأت سـاعـة الـسـعـادة!',
          message: `تم تفعيل مضاعفة النقاط x${result.happyHourMultiplier} الآن! اطلب واستمتع بمكافآت إضافية.`,
          multiplier: result.happyHourMultiplier
        }
      });

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

      await this.container.outboxService.enqueue(tx, {
        type: 'system.broadcast',
        aggregateId: result.id,
        aggregateType: 'LoyaltyConfig',
        payload: {
          title: '🏁 انتهت ساعة السعادة',
          message: 'انتهت فترة مضاعفة النقاط حالياً، شكراً لتواجدكم معنا. انتظرونا في فترات قادمة!',
        }
      });

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
   * ✅ حساب النقاط المكتسبة بدقة مصرفية عالية وتجنب انحراف الفاصلة العائمة
   */
  calculateEarnedPoints(orderTotal, multiplier = 1.0, baseRate = 1.0) {
    const total = new Decimal(orderTotal || 0);
    const mult = new Decimal(multiplier || 1.0);
    const rate = new Decimal(baseRate || 1.0);

    const earned = total.times(mult).times(rate);
    const mode = financialConfig?.LOYALTY?.ROUNDING_MODE || Decimal.ROUND_HALF_UP;
    const dp = financialConfig?.LOYALTY?.POINT_PRECISION !== undefined ? financialConfig.LOYALTY.POINT_PRECISION : 0;
    const result = earned.toDecimalPlaces(dp, mode).toNumber();

    if (typeof trackLoyaltyCalculation === 'function') {
      trackLoyaltyCalculation(earned.toDecimalPlaces(0, mode).minus(earned).abs().gt(0));
    }

    return result;
  }

  /**
   * ✅ حساب القيمة النقدية المستهلكة/المخصومة بدقة
   */
  calculateRedemption(pointsToRedeem, redemptionRate = 0.01) {
    const points = new Decimal(pointsToRedeem || 0);
    const rate = new Decimal(redemptionRate || 0.01);
    
    const cashValue = points.times(rate);
    const mode = financialConfig?.WALLET?.ROUNDING_MODE || Decimal.ROUND_HALF_UP;
    const dp = financialConfig?.WALLET?.CURRENCY_PRECISION !== undefined ? financialConfig.WALLET.CURRENCY_PRECISION : 2;
    return cashValue.toDecimalPlaces(dp, mode).toNumber();
  }

  /**
   * ✅ تسوية النقاط مع حماية محصنة ضد ظهور الأرصدة السالبة
   */
  async adjustPoints(customerId, amount, reason) {
    const isNumericId = typeof customerId === 'number' || !isNaN(parseInt(customerId, 10));
    const queryWhere = isNumericId ? { id: parseInt(customerId, 10) } : { uuid: String(customerId) };

    return await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: queryWhere,
        select: { id: true, points: true, uuid: true }
      });

      if (!customer) throw new Error('العميل غير موجود');

      const current = new Decimal(customer.points || 0);
      const adjustment = new Decimal(amount || 0);
      const newTotal = current.plus(adjustment);

      // منع الرصيد السالب بدقة
      if (newTotal.lt(financialConfig?.LOYALTY?.MIN_POINTS || 0)) {
        if (typeof trackNegativeBalancePrevented === 'function') {
          trackNegativeBalancePrevented();
        }

        if (this.logger && typeof this.logger.warn === 'function') {
          this.logger.warn('[Loyalty] Negative balance prevented', {
            customerId,
            attemptedAdjustment: amount,
            currentBalance: current.toNumber()
          });
        }

        throw new Error('INSUFFICIENT_POINTS');
      }

      const updated = await tx.customer.update({
        where: { id: customer.id },
        data: { points: newTotal.toNumber() }
      });

      await tx.customerAuditLog.create({
        data: {
          customerId: customer.id,
          eventType: 'LOYALTY_ADJUSTMENT',
          eventAction: 'MANUAL_ADJUSTMENT',
          changedBy: customer.uuid,
          changedByRole: 'system',
          reason: reason || 'تسوية حسابية دقيقة',
          previousData: JSON.stringify({ points: current.toNumber() }),
          newData: JSON.stringify({ points: newTotal.toNumber() }),
          diff: adjustment.gte(0) ? `+${adjustment.toNumber()} points` : `${adjustment.toNumber()} points`,
          actionCategory: 'LOYALTY',
          requestSource: 'SYSTEM_AUDIT'
        }
      });

      return updated;
    });
  }

  /**
   * 🧮 Pure Calculation: Points earned for a given order
   */
  async calculatePointsForOrder(order) {
    if (!order || !order.customerId) return 0;
    
    const config = await this.getConfig();
    let multiplier = 1.0;

    // Apply Tier Multipliers
    if (order.customer?.tier === 'GOLD') multiplier = config.tierMultipliers?.GOLD || 1.1;
    if (order.customer?.tier === 'PLATINUM') multiplier = config.tierMultipliers?.PLATINUM || 1.25;

    // Apply Time-Based Multipliers (Happy Hour, etc)
    const now = new Date();
    if (config.happyHour?.isActive) {
      const hour = now.getHours();
      if (hour >= config.happyHour.start && hour < config.happyHour.end) {
        multiplier *= (config.happyHour.multiplier || 1.5);
      }
    }

    const points = this.calculateEarnedPoints(toNumber(order.total), multiplier, config.basePointsPerUnit);
    return points;
  }

  /**
   * 🧮 Pure Calculation: Points for specific engagement type
   */
  async calculateEngagementPoints(type) {
    const config = await this.getConfig();
    switch (type) {
      case 'REVIEW': return config.reviewPoints || 50;
      case 'SOCIAL_SHARE': return config.socialPoints || 20;
      case 'REFERRAL': return config.referralPoints || 100;
      default: return 0;
    }
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
          include: { customer: true, branch: { select: { timezone: true } } }
        });
      }

      const orderId = order?.id;

      if (!order || !order.customerId || order.status !== 'delivered') {
        this.logger.info(`[Loyalty] Skipping points for order ${orderId} (Status: ${order?.status}, HasCustomer: ${!!order?.customerId})`);
        return 0;
      }

      // 🛡️ Idempotency Guard: Check if points have already been awarded for this order
      const existingAward = await db.awardedLoyaltyPoints.findUnique({ 
        where: { orderId } 
      });
      
      if (existingAward) {
        this.logger.warn(`[Loyalty] Points already awarded for order ${orderId}. Skipping duplicate award.`);
        return 0;
      }

      const config = await this.getConfig();
      const customer = order.customer;

      let multiplierDec = new Decimal(1.0);
      if (customer.tier === 'GOLD') multiplierDec = toDecimal(config.pointsMultiplierGold);
      if (customer.tier === 'PLATINUM') multiplierDec = toDecimal(config.pointsMultiplierPlatinum);

      const orderTz = order.branch?.timezone || 'Africa/Cairo';
      if (this._isWithinHappyHour(config, order.createdAt, orderTz)) {
        multiplierDec = multiplierDec.times(toDecimal(config.happyHourMultiplier));
        this.logger.info(`[Loyalty] Happy Hour active for order #${order.orderNumber}! Applying ${config.happyHourMultiplier}x multiplier`);
      }

      // 🛡️ [BUG-06 FIX] Cap cumulative points multiplier to prevent points inflation (max 3.5x multiplier)
      multiplierDec = Decimal.min(multiplierDec, new Decimal(3.5));

      const subDec = toDecimal(order.subtotal || 0);
      const discDec = toDecimal(order.discount || 0);
      const netSubtotalDec = Decimal.max(0, subDec.minus(discDec));
      
      const pointsEarned = this.calculateEarnedPoints(netSubtotalDec, multiplierDec.toNumber(), config.pointsPerJod);

      if (this.logger && typeof this.logger.debug === 'function') {
        this.logger.debug('[Loyalty] Points calculation audit', {
          orderId: order.id,
          subtotal: order.subtotal,
          discount: order.discount,
          netSubtotal: subDec.minus(discDec).toString(),
          multiplier: multiplier.toString(),
          pointsPerJod: config.pointsPerJod,
          calculatedPoints: pointsEarned,
          roundingMode: 'ROUND_HALF_UP',
          timestamp: new Date().toISOString()
        });
      }

      if (pointsEarned <= 0) return 0;

      // 🔐 Atomic Transaction: Ensure points are awarded AND recorded as awarded
      const result = await db.$transaction(async (transaction) => {
        // Double-check inside transaction for absolute safety
        const doubleCheck = await transaction.awardedLoyaltyPoints.findUnique({ where: { orderId } });
        if (doubleCheck) return 0;

        const updatedCustomer = await this.container.financialService.awardPoints(order.customerId, pointsEarned, 'ORDER', transaction);
        
        await transaction.customer.update({
          where: { id: order.customerId },
          data: { totalOrders: { increment: 1 } }
        });
        
        await this.evaluateTierUpgrade(updatedCustomer.id, config, transaction);

        // 📝 Record the award for audit and idempotency
        await transaction.awardedLoyaltyPoints.create({
          data: {
            orderId: order.id,
            customerId: order.customerId,
            points: pointsEarned,
            multiplier: multiplier
          }
        });

        // Sync order flag as well for compatibility
        await transaction.order.update({
          where: { id: order.id },
          data: { pointsAwarded: true }
        });

        return pointsEarned;
      });

      return result;
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
      const result = await this.prisma.$transaction(async (tx) => {
        const entry = await this.container.loyaltyLedgerService.credit(
          customerId,
          points,
          'ENGAGEMENT',
          null,
          reason,
          `eng:${type}:${customerId}:${Date.now()}`,
          { type },
          tx
        );

        await tx.customerAuditLog.create({
          data: {
            customerId,
            eventType: 'LOYALTY_REWARD',
            eventAction: type,
            reason: reason,
            diff: `+${points} points`,
            actionCategory: 'LOYALTY',
            metadata: { type, points }
          }
        });

        return entry.balanceAfter;
      });

      // 🔄 Sync Projection
      await this.container.loyaltyLedgerService.syncProjection(customerId, result);
      return result;
    }
  }

  async compensatePointsForCancellation(orderId, reason = 'تأخير من المطعم') {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: true }
      });
      if (!order || !order.customerId) return null;
      const compensationRate = toDecimal(config.cancellationCompensationRate || 0.05);
      const pointsPerJod = toDecimal(config.pointsPerJod || 1);
      const minCompensation = new Decimal(config.minCompensationPoints || 50);

      const baseCalc = toDecimal(order.total).times(compensationRate).times(pointsPerJod).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      const amount = Decimal.max(minCompensation, baseCalc).toNumber();
      
      // 🛡️ [PHASE 6] Ledger Mutation
      const entry = await this.container.loyaltyLedgerService.credit(
        order.customerId,
        amount,
        'COMPENSATION',
        orderId,
        `تعويض عن إلغاء الطلب #${order.orderNumber}`,
        `comp:${orderId}`,
        { reason }
      );

      // 🔄 Sync Projection
      await this.container.loyaltyLedgerService.syncProjection(order.customerId, entry.balanceAfter);

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
        title: data.title, 
        titleEn: data.titleEn, 
        description: data.description, 
        descriptionEn: data.descriptionEn,
        pointsCost: parseInt(data.pointsCost), 
        image: data.image !== undefined ? data.image : data.imageUrl, 
        isActive: data.isActive !== undefined ? data.isActive : true
      }
    });
  }

  async updateReward(id, data) {
    const updatePayload = {};
    if (data.title !== undefined) updatePayload.title = data.title;
    if (data.titleEn !== undefined) updatePayload.titleEn = data.titleEn;
    if (data.description !== undefined) updatePayload.description = data.description;
    if (data.descriptionEn !== undefined) updatePayload.descriptionEn = data.descriptionEn;
    if (data.image !== undefined || data.imageUrl !== undefined) {
      updatePayload.image = data.image !== undefined ? data.image : data.imageUrl;
    }
    if (data.pointsCost !== undefined) updatePayload.pointsCost = parseInt(data.pointsCost);
    if (data.isActive !== undefined) updatePayload.isActive = data.isActive;

    return await this.prisma.rewardItem.update({
      where: { id },
      data: updatePayload
    });
  }

  async deleteReward(id) { return await this.prisma.rewardItem.delete({ where: { id } }); }

  async claimReward(customerId, rewardId, requestId = null) {
    const crypto = require('crypto');
    const result = await this.prisma.$transaction(async (tx) => {
      const reward = await tx.rewardItem.findUnique({ where: { id: rewardId } });
      if (!reward || !reward.isActive) throw new Error('المكافأة غير متاحة حالياً');

      // 🛡️ [PHASE 7] Tier Enforcement
      const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { tier: true } });
      const tierRank = { 'SILVER': 1, 'GOLD': 2, 'PLATINUM': 3 };
      const customerRank = tierRank[customer.tier] || 1;
      const requiredRank = tierRank[reward.minTier] || 1;

      if (customerRank < requiredRank) {
        throw new Error(`هذه المكافأة متاحة فقط لمستوى ${reward.minTier} أو أعلى.`);
      }

      // 🛡️ [PHASE 5] Use LoyaltyLedger for atomic, auditable debit
      // Use stable requestId for idempotency if provided, else fallback to time-safe uuid
      const idempotencyKey = requestId ? `claim:${customerId}:${reward.id}:${requestId}` : `claim:${customerId}:${reward.id}:${uuidv4()}`;
      
      const ledgerEntry = await this.container.loyaltyLedgerService.debit(
        customerId,
        reward.pointsCost,
        'REDEMPTION',
        reward.id,
        `استبدال مكافأة: ${reward.title}`,
        idempotencyKey,
        { rewardTitle: reward.title },
        tx
      );

      // 🔐 [FRAUD-FIX] Cryptographically secure alphanumeric code (10 chars)
      const code = 'RW-' + crypto.randomBytes(5).toString('hex').toUpperCase();
      
      const config = await this.getConfig();
      const expiresAt = new Date(Date.now() + (config.rewardExpiryDays || 30) * 24 * 60 * 60 * 1000);

      const customerReward = await tx.customerReward.create({
        data: {
          customerId: customerId,
          rewardItemId: reward.id,
          code: code,
          expiresAt: expiresAt
        },
        include: { rewardItem: true }
      });

      // 🔄 [CONSISTENCY-FIX] Sync Projection INSIDE transaction boundary
      await tx.customer.update({
        where: { id: customerId },
        data: { points: ledgerEntry.balanceAfter }
      });

      return { success: true, code, balanceAfter: ledgerEntry.balanceAfter, customerReward };
    }, { timeout: 20000 });

    return result;
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
