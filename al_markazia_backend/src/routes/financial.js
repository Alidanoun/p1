const express = require('express');
const financialApprovalController = require('../controllers/financialApprovalController');
const { authenticateToken: authMiddleware, isAdmin } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

/**
 * 🔒 Financial Control Tower Routes
 * Restricted to Admins only.
 */

const BranchAccessMiddleware = require('../middleware/branchAccessMiddleware');

const financialReportController = require('../controllers/financialReportController');

router.get('/approvals/pending', authMiddleware, checkPermission('financials', 'VIEW'), BranchAccessMiddleware, financialApprovalController.getPendingApprovals);
router.get('/approvals/stats', authMiddleware, checkPermission('financials', 'VIEW'), BranchAccessMiddleware, financialApprovalController.getApprovalStats);
router.post('/close-day', authMiddleware, isAdmin, financialApprovalController.closeDay);
router.post('/approvals/:id/approve', authMiddleware, checkPermission('financials', 'EDIT_PIN'), BranchAccessMiddleware, financialApprovalController.approve);
router.post('/approvals/:id/reject', authMiddleware, checkPermission('financials', 'EDIT_PIN'), BranchAccessMiddleware, financialApprovalController.reject);

// 📈 Reporting & Snapshots (Step 2 & 3 Implementation)
router.get('/reports/overview', authMiddleware, checkPermission('financials', 'VIEW'), BranchAccessMiddleware, financialReportController.getBranchOverview);
router.get('/reports/historical', authMiddleware, checkPermission('financials', 'VIEW'), BranchAccessMiddleware, financialReportController.getHistoricalReports);
router.get('/reports/global', authMiddleware, isAdmin, financialReportController.getGlobalDashboard);
router.post('/reports/snapshot/trigger', authMiddleware, isAdmin, financialReportController.triggerSnapshot);

module.exports = router;

