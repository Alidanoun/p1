const loyaltyService = require('../services/loyaltyService');

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
        pointsMultiplierPlatinum: config.pointsMultiplierPlatinum
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
}

module.exports = new LoyaltyController();
