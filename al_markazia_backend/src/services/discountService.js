'use strict';

const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const redis = require('../lib/redis');


class DiscountService {
  /**
   * Reload all active campaigns and their coupons into Redis cache.
   * Cached at `system:discounts:active`.
   */
  static async refreshActiveCampaignsCache() {
    try {
      const activeCampaigns = await prisma.discountCampaign.findMany({
        where: {
          isActive: true,
          startDate: { lte: new Date() },
          endDate: { gte: new Date() },
        },
        include: {
          coupons: {
            select: { code: true, globalUsageLimit: true, usedCount: true, userUsageLimit: true }
          }
        }
      });

      // We store a minimal representation to evaluate cart conditions quickly
      const cacheData = activeCampaigns.map(c => ({
        id: c.id,
        type: c.type,
        value: Number(c.value),
        minOrderValue: Number(c.minOrderValue),
        maxDiscount: c.maxDiscount ? Number(c.maxDiscount) : null,
        targetScope: c.targetScope,
        targetId: c.targetId,
        coupons: c.coupons.map(cp => ({
          code: cp.code,
          isAvailable: cp.globalUsageLimit === null || cp.usedCount < cp.globalUsageLimit
        }))
      }));

      await redis.set('system:discounts:active', JSON.stringify(cacheData), 'EX', 3600);
      logger.info('[DiscountService] Successfully refreshed active campaigns in Redis.', { count: activeCampaigns.length });
    } catch (error) {
      logger.error('[DiscountService] Failed to refresh active campaigns cache', { error: error.message });
    }
  }

  /**
   * Validates a coupon against the cart WITHOUT locking. Used for early validation before checkout.
   */
  static async validateCouponForCart(code, customerId, cartSubtotal, targetBranchId, targetCustomerTier) {
    const coupon = await prisma.coupon.findUnique({
      where: { code: code.toUpperCase() },
      include: { campaign: true }
    });

    if (!coupon) throw new Error('الكوبون غير صالح أو غير موجود');
    
    const { campaign } = coupon;

    if (!campaign.isActive || new Date() < campaign.startDate || new Date() > campaign.endDate) {
      throw new Error('انتهت صلاحية هذا العرض أو أنه غير مفعل');
    }

    if (coupon.globalUsageLimit !== null && coupon.usedCount >= coupon.globalUsageLimit) {
      throw new Error('نفدت كمية هذا الكوبون المتاحة');
    }

    if (cartSubtotal < Number(campaign.minOrderValue)) {
      throw new Error(`الحد الأدنى لاستخدام هذا الكوبون هو ${campaign.minOrderValue}`);
    }

    // Target Scope Validations
    if (campaign.targetScope === 'BRANCH_SPECIFIC' && campaign.targetId !== targetBranchId) {
      throw new Error('هذا الكوبون غير متاح في هذا الفرع');
    }
    if (campaign.targetScope === 'CUSTOMER_TIER' && campaign.targetId !== targetCustomerTier) {
      throw new Error('هذا الكوبون مخصص لفئة عملاء مختلفة');
    }

    // User limit validation
    const userUsageCount = await prisma.discountUsage.count({
      where: { couponId: coupon.id, customerId, status: 'APPLIED' }
    });

    if (userUsageCount >= coupon.userUsageLimit) {
      throw new Error('لقد تجاوزت الحد الأقصى المسموح لاستخدام هذا الكوبون');
    }

    return { coupon, campaign };
  }

  /**
   * Calculates the actual discount amount based on the campaign type.
   */
  static calculateDiscountAmount(campaign, cartSubtotal) {
    let discountAmount = 0;
    const subtotal = Number(cartSubtotal);
    const value = Number(campaign.value);

    switch (campaign.type) {
      case 'PERCENTAGE':
        discountAmount = subtotal * (value / 100);
        if (campaign.maxDiscount && discountAmount > Number(campaign.maxDiscount)) {
          discountAmount = Number(campaign.maxDiscount);
        }
        break;
      case 'FIXED_AMOUNT':
        discountAmount = value;
        if (discountAmount > subtotal) {
          discountAmount = subtotal; // Cannot discount more than the cart value
        }
        break;
      case 'FREE_SHIPPING':
        // FREE_SHIPPING logic should be handled by the caller to nullify delivery fee.
        discountAmount = 0;
        break;
    }
    return discountAmount;
  }
}

module.exports = DiscountService;
