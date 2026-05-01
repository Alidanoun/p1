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
      const customerId = req.user.uuid; // From authenticateToken
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const redisKey = `loyalty:share_throttle:${customerId}:${today}`;

      // Check if already shared today
      const alreadyShared = await redis.get(redisKey);
      if (alreadyShared) {
        return res.json({ success: true, rewarded: false, message: 'لقد حصلت على مكافأة المشاركة اليوم مسبقاً.' });
      }

      const customer = await prisma.customer.findUnique({ where: { uuid: customerId } });
      if (!customer) return res.status(404).json({ error: 'Customer not found' });

      // Reward points
      await loyaltyService.awardEngagementPoints(customer.id, 'SOCIAL_SHARE');

      // Set throttle for 24 hours
      await redis.set(redisKey, '1', 'EX', 60 * 60 * 24);

      res.json({ success: true, rewarded: true, message: 'تم إضافة نقاط المشاركة لمحفظتك!' });
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
        where: { uuid: req.user.uuid }
      });
      if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

      const customerReward = await loyaltyService.claimReward(customer.id, req.body.rewardId);
      res.json({ success: true, data: customerReward });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  // 📱 App: Get My Claimed Rewards
  async getMyRewards(req, res) {
    try {
      const customer = await require('../lib/prisma').customer.findUnique({
        where: { uuid: req.user.uuid }
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
        where: { uuid: req.user.uuid },
        select: { id: true, name: true, points: true, tier: true, totalOrders: true }
      });

      if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

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
          nextTier,
          targetOrders,
          progress: Math.min(100, Math.round(progress))
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}
module.exports = new LoyaltyController();
