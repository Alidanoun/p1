const analyticsService = require('../services/analyticsService');
const logger = require('../utils/logger');

/**
 * 📊 Analytics Controller
 */
exports.getBranchDailyReport = async (req, res) => {
  try {
    const user = req.user;
    
    // Resolve branchId (Self for manager, query param for admin)
    const branchId = user.role === 'BRANCH_MANAGER' ? user.branchId : req.query.branchId;

    if (!branchId) {
      return res.status(400).json({ success: false, error: 'branchId is required' });
    }

    const report = await analyticsService.getBranchOperationalReport(branchId);
    
    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    logger.error('Failed to fetch branch report', { error: error.message });
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};
