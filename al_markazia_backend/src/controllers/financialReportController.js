const { DateTime } = require('luxon');
const logger = require('../utils/logger');

/**
 * 📈 Financial Report Controller
 * Provides high-level financial reporting and snapshot management.
 */
class FinancialReportController {
  
  /**
   * 📊 Get Branch Financial Overview (Live Aggregation)
   */
  async getBranchOverview(req, res) {
    try {
      const { branchId, startDate, endDate } = req.query;
      const user = req.user;

      // 🛡️ Security Isolation
      const targetBranchId = user.role === 'admin' ? branchId : user.branchId;
      if (user.role !== 'admin' && branchId && branchId !== user.branchId) {
        return res.status(403).json({ success: false, error: 'ACCESS_DENIED' });
      }

      const start = startDate ? new Date(startDate) : new Date();
      const end = endDate ? new Date(endDate) : new Date();

      const metrics = await req.container.financialAggregatorService.aggregateBranchData(
        targetBranchId,
        start,
        end
      );

      res.json({ success: true, data: metrics });
    } catch (err) {
      logger.error('Financial Overview Failed', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * 🏛️ Get Historical Snapshots (Performance Optimized)
   */
  async getHistoricalReports(req, res) {
    try {
      const { branchId, days = 30 } = req.query;
      const user = req.user;

      const targetBranchId = user.role === 'admin' ? branchId : user.branchId;

      const snapshots = await req.container.financialSnapshotService.getTrend(
        targetBranchId,
        parseInt(days)
      );

      res.json({ success: true, data: snapshots });
    } catch (err) {
      logger.error('Historical Reports Failed', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * ❄️ Manually Trigger Snapshot (Admin Only)
   */
  async triggerSnapshot(req, res) {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'ADMIN_ONLY' });

      const { branchId, date } = req.body;
      const targetDate = date ? new Date(date) : new Date();

      const snapshot = await req.container.financialSnapshotService.createDailySnapshot(
        branchId,
        targetDate
      );

      res.json({ success: true, data: snapshot });
    } catch (err) {
      logger.error('Manual Snapshot Trigger Failed', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * 🌎 Global Platform Dashboard (Admin Only)
   */
  async getGlobalDashboard(req, res) {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'ADMIN_ONLY' });

      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate) : DateTime.now().minus({ days: 30 }).toJSDate();
      const end = endDate ? new Date(endDate) : new Date();

      const globalSummary = await req.container.financialAggregatorService.getGlobalFinancialSummary(
        start,
        end
      );

      res.json({ success: true, data: globalSummary });
    } catch (err) {
      logger.error('Global Dashboard Failed', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

module.exports = new FinancialReportController();
