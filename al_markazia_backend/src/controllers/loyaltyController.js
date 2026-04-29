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
