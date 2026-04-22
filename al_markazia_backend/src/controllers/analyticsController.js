const analyticsService = require('../services/analyticsService');
const logger = require('../utils/logger');

/**
 * Analytics Controller - Dashboard Engine
 * Provides the initial state for the Live Command Center.
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const metrics = await analyticsService.getSnapshot();
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error('Analytics Fetch Failed', { error: error.message });
    res.status(500).json({ success: false, error: 'فشل في جلب الإحصائيات' });
  }
};
