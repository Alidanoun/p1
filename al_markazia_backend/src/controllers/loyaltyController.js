const loyaltyService = require('../services/loyaltyService');
const redis = require('../lib/redis');
const prisma = require('../lib/prisma');

/**
 * 🎁 Loyalty Controller
 * Admin controls for the loyalty system.
 */
class LoyaltyController {
  /**
   * Get Loyalty Settings
   */
  async getSettings(req, res) {
    try {
      const config = await loyaltyService.getConfig();
      res.json({ success: true, data: config });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Get Public Loyalty Status (For Mobile App)
   */
  async getStatus(req, res) {
    try {
      const config = await loyaltyService.getConfig();
      // Return only what the mobile app needs
      const publicData = {
        isHappyHourEnabled: config.isHappyHourEnabled,
        happyHourMultiplier: config.happyHourMultiplier,
        happyHourStatus: config.happyHourStatus,
        pointsPerJod: config.pointsPerJod,
        pointsMultiplierGold: config.pointsMultiplierGold,
        pointsMultiplierPlatinum: config.pointsMultiplierPlatinum,
        pointsToJodRate: config.pointsToJodRate,
        minPointsToRedeem: config.minPointsToRedeem
      };
      res.json({ success: true, data: publicData });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * 🚀 Start Happy Hour Now (Manual Trigger)
   */
  async startNow(req, res) {
    try {
      const config = await loyaltyService.startNow();
      res.json({ success: true, data: config });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * 🛑 Stop Happy Hour Now (Manual Trigger)
   */
  async stopNow(req, res) {
    try {
      const config = await loyaltyService.stopNow();
      res.json({ success: true, data: config });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Update Loyalty Settings
   */
  async updateSettings(req, res) {
    try {
      const config = await loyaltyService.updateConfig(req.body);
      res.json({ success: true, data: config });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * 📤 Reward Social Share (For Mobile App)
   * Throttled to once per day per customer.
   */
  async rewardSocialShare(req, res) {
    try {
      const customerUuid = req.user.id; 
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const redisKey = `loyalty:share_throttle:${customerUuid}:${today}`;

      const customer = await prisma.customer.findUnique({ where: { uuid: customerUuid }, select: { id: true } });
      if (!customer) return res.status(404).json({ error: 'Customer not found' });

      // 🛡️ [SEC-FIX] Atomic Daily Throttle (Prevent Race Condition)
      const acquired = await redis.set(redisKey, '1', 'NX', 'EX', 86400); 
      
      if (!acquired) {
        return res.json({ success: true, rewarded: false, message: 'لقد حصلت على مكافأة المشاركة اليوم مسبقاً.' });
      }

      // 🎁 [LOYALTY-FIX] Emit event for background processing
      const points = await loyaltyService.calculateEngagementPoints('SOCIAL_SHARE');
      
      await prisma.outboxEvent.create({
        data: {
          type: 'loyalty.social_reward',
          aggregateId: String(customer.id),
          aggregateType: 'Customer',
          payload: {
            customerId: customer.id,
            action: 'SHARE',
            points,
            date: today,
            requestId: req.id || req.header('x-request-id')
          }
        }
      });

      res.json({ 
        success: true, 
        rewarded: true, 
        message: 'سيتم إضافة نقاط المشاركة لمحفظتك قريباً!',
        points
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
  // 🛒 Admin: Get All Rewards
  async getAllRewards(req, res) {
    try {
      const rewards = await loyaltyService.getAllRewards();
      res.json({ success: true, data: rewards });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // 🛒 Admin: Create Reward
  async createReward(req, res) {
    try {
      const reward = await loyaltyService.createReward(req.body);
      res.json({ success: true, data: reward });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // 🛒 Admin: Update Reward
  async updateReward(req, res) {
    try {
      const reward = await loyaltyService.updateReward(parseInt(req.params.id), req.body);
      res.json({ success: true, data: reward });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // 🛒 Admin: Delete Reward
  async deleteReward(req, res) {
    try {
      await loyaltyService.deleteReward(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // 📱 App: Get Active Rewards Store
  async getActiveRewards(req, res) {
    try {
      const rewards = await loyaltyService.getActiveRewards();
      res.json({ success: true, data: rewards });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // 📱 App: Claim a Reward
  async claimReward(req, res) {
    try {
      const customer = await require('../lib/prisma').customer.findUnique({
        where: { uuid: req.user.id }
      });
      if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

      const requestId = req.id || req.header('x-request-id') || require('uuid').v4();
      const customerReward = await loyaltyService.claimReward(customer.id, req.body.rewardId, requestId);
      res.json({ success: true, data: customerReward });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  // 📱 App: Get My Claimed Rewards
  async getMyRewards(req, res) {
    try {
      const customer = await require('../lib/prisma').customer.findUnique({
        where: { uuid: req.user.id }
      });
      if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

      const myRewards = await loyaltyService.getCustomerRewards(customer.id);
      res.json({ success: true, data: myRewards });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
  // 📱 App: Get My Loyalty Profile (Points + Tier Progress)
  async getMyLoyaltyProfile(req, res) {
    try {
      const customer = await prisma.customer.findUnique({
        where: { uuid: req.user.id },
        select: { id: true, name: true, points: true, tier: true, totalOrders: true, referralCode: true }
      });

      if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

      // Generate a referral code on-demand if it's missing (for existing users)
      let referralCode = customer.referralCode;
      if (!referralCode) {
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 5) {
          referralCode = 'REF-' + require('crypto').randomBytes(3).toString('hex').toUpperCase();
          const existingCode = await prisma.customer.findUnique({ where: { referralCode } });
          if (!existingCode) {
            isUnique = true;
          }
          attempts++;
        }
        await prisma.customer.update({
          where: { id: customer.id },
          data: { referralCode }
        });
      }

      const config = await loyaltyService.getConfig();

      // Calculate progress to next tier
      let nextTier = 'GOLD';
      let targetOrders = config.tierGoldMinOrders;
      
      if (customer.tier === 'GOLD') {
        nextTier = 'PLATINUM';
        targetOrders = config.tierPlatinumMinOrders;
      } else if (customer.tier === 'PLATINUM') {
        nextTier = 'MAX';
        targetOrders = config.tierPlatinumMinOrders;
      }

      const progress = nextTier === 'MAX' ? 100 : (customer.totalOrders / targetOrders) * 100;

      res.json({
        success: true,
        data: {
          ...customer,
          referralCode,
          nextTier,
          targetOrders,
          progress: Math.min(100, Math.round(progress))
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * 📱 App: Get My Loyalty Ledger History (Points history)
   */
  async getMyLoyaltyLedger(req, res) {
    try {
      const customer = await prisma.customer.findUnique({
        where: { uuid: req.user.id }
      });
      if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

      const ledger = await prisma.loyaltyLedger.findMany({
        where: { customerId: customer.id, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        take: 100
      });

      res.json({ success: true, data: ledger });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * 🎟️ Generate or return Referral Code
   */
  async generateReferralCode(req, res) {
    try {
      const customerUuid = req.user.id;
      const customer = await prisma.customer.findUnique({
        where: { uuid: customerUuid },
        select: { id: true, referralCode: true }
      });
      if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });
      
      if (customer.referralCode) {
        return res.json({ success: true, referralCode: customer.referralCode });
      }

      let myReferralCode;
      let isUnique = false;
      let attempts = 0;
      while (!isUnique && attempts < 5) {
        myReferralCode = 'REF-' + require('crypto').randomBytes(3).toString('hex').toUpperCase();
        const existingCode = await prisma.customer.findUnique({ where: { referralCode: myReferralCode } });
        if (!existingCode) {
          isUnique = true;
        }
        attempts++;
      }

      await prisma.customer.update({
        where: { id: customer.id },
        data: { referralCode: myReferralCode }
      });

      res.json({ success: true, referralCode: myReferralCode });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}
module.exports = new LoyaltyController();
