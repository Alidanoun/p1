const analyticsService = require('../services/analyticsService');
const logger = require('../utils/logger');

/**
 * 📊 Analytics Controller
 */
exports.getBranchDailyReport = async (req, res) => {
  try {
    const user = req.user;
    
    const report = await analyticsService.getBranchOperationalReport(req.user, req.query.branchId);
    
    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    logger.error('Failed to fetch branch report', { error: error.message });
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

/**
 * 📈 Advanced Analytics Dashboard (Admin)
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const { period = 'today' } = req.query;
    
    // 🛡️ [PHASE 5] Standardized Analytics Service
    const metrics = await req.container.analyticsService.getDashboardMetrics(req.user, period);

    res.json({
      success: true,
      data: metrics
    });

  } catch (error) {
    logger.error('Failed to fetch dashboard stats', { error: error.message });
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};
