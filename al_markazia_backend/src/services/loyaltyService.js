const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

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
    return config;
  }

  /**
   * Update Loyalty Configuration
   */
  async updateConfig(data) {
    return await prisma.loyaltyConfig.update({
      where: { id: 1 },
      data
    });
  }

  /**
   * Award Points for Order Completion
   */
  async awardPointsForOrder(orderId) {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: true }
      });

      if (!order || !order.customerId || order.status !== 'delivered') return;

      const config = await this.getConfig();
      const customer = order.customer;

      // 1. Calculate Base Points
      let multiplier = 1.0;
      if (customer.tier === 'GOLD') multiplier = config.pointsMultiplierGold;
      if (customer.tier === 'PLATINUM') multiplier = config.pointsMultiplierPlatinum;

      // 2. Apply Happy Hour Multiplier if active
      if (config.isHappyHourEnabled) {
        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes();
        const [startH, startM] = config.happyHourStart.split(':').map(Number);
        const [endH, endM] = config.happyHourEnd.split(':').map(Number);
        const startTime = startH * 60 + startM;
        const endTime = endH * 60 + endM;

        if (currentTime >= startTime && currentTime <= endTime) {
          multiplier *= config.happyHourMultiplier;
          logger.info(`Happy Hour active! Applying ${config.happyHourMultiplier}x multiplier`);
        }
      }

      const pointsEarned = Math.floor(Number(order.subtotal) * config.pointsPerJod * multiplier);

      // 3. Update Customer Points & Total Orders
      const updatedCustomer = await prisma.customer.update({
        where: { id: order.customerId },
        data: {
          points: { increment: pointsEarned },
          totalOrders: { increment: 1 }
        }
      });

      // 3. Evaluate Tier Upgrade
      await this.evaluateTierUpgrade(updatedCustomer.id, config);

      logger.info(`Awarded ${pointsEarned} points to customer ${customer.id} for order ${orderId}`);
      return pointsEarned;
    } catch (err) {
      logger.error('Failed to award loyalty points', { error: err.message, orderId });
    }
  }

  /**
   * Evaluate and Upgrade Customer Tier
   */
  async evaluateTierUpgrade(customerId, config) {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return;

    let newTier = 'SILVER';
    if (customer.totalOrders >= config.tierPlatinumMinOrders) {
      newTier = 'PLATINUM';
    } else if (customer.totalOrders >= config.tierGoldMinOrders) {
      newTier = 'GOLD';
    }

    if (newTier !== customer.tier) {
      await prisma.customer.update({
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
}

module.exports = new LoyaltyService();
