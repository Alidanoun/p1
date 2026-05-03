const financialApprovalService = require('../services/financialApprovalService');
const logger = require('../utils/logger');

/**
 * 🛰️ Financial Approval Controller
 */

exports.getPendingApprovals = async (req, res) => {
  try {
    const approvals = await financialApprovalService.getPendingApprovals(req.query.branchId);
    res.json({ success: true, data: approvals });
  } catch (error) {
    logger.error('Fetch pending approvals error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch approvals' });
  }
};

exports.getApprovalStats = async (req, res) => {
  try {
    const stats = await financialApprovalService.getApprovalStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

exports.approve = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const result = await financialApprovalService.approve(id, req.user, reason);
    res.json(result);
  } catch (error) {
    logger.error('Approval error', { error: error.message, id: req.params.id });
    res.status(400).json({ error: error.message });
  }
};

exports.reject = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const result = await financialApprovalService.reject(id, req.user, reason);
    res.json(result);
  } catch (error) {
    logger.error('Rejection error', { error: error.message, id: req.params.id });
    res.status(400).json({ error: error.message });
  }
};

exports.closeDay = async (req, res) => {
  try {
    const { date } = req.body;
    const snapshotService = require('../services/snapshotService');
    const result = await snapshotService.createDailySnapshot(date, req.user.branchId);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Close day error', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};
