const express = require('express');
const financialApprovalController = require('../controllers/financialApprovalController');
const { authenticateToken: authMiddleware, isAdmin } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissionMiddleware');
const idempotency = require('../services/idempotencyService');

const router = express.Router();

/**
 * 🔒 Financial Control Tower Routes
 * Restricted to Admins only.
 */

const BranchAccessMiddleware = require('../middleware/branchAccessMiddleware');

const financialReportController = require('../controllers/financialReportController');

router.get('/approvals/pending', authMiddleware, checkPermission('financials', 'VIEW'), BranchAccessMiddleware, financialApprovalController.getPendingApprovals);
router.get('/approvals/stats', authMiddleware, checkPermission('financials', 'VIEW'), BranchAccessMiddleware, financialApprovalController.getApprovalStats);
router.post('/close-day', authMiddleware, isAdmin, idempotency.guard(true), financialApprovalController.closeDay);
router.post('/approvals/:id/approve', authMiddleware, checkPermission('financials', 'EDIT_PIN'), BranchAccessMiddleware, idempotency.guard(true), financialApprovalController.approve);
router.post('/approvals/:id/reject', authMiddleware, checkPermission('financials', 'EDIT_PIN'), BranchAccessMiddleware, idempotency.guard(true), financialApprovalController.reject);

// 📈 Reporting & Snapshots (Step 2 & 3 Implementation)
router.get('/reports/overview', authMiddleware, checkPermission('financials', 'VIEW'), BranchAccessMiddleware, financialReportController.getBranchOverview);
router.get('/reports/historical', authMiddleware, checkPermission('financials', 'VIEW'), BranchAccessMiddleware, financialReportController.getHistoricalReports);
router.get('/reports/global', authMiddleware, isAdmin, financialReportController.getGlobalDashboard);
router.post('/reports/snapshot/trigger', authMiddleware, isAdmin, idempotency.guard(true), financialReportController.triggerSnapshot);

module.exports = router;

