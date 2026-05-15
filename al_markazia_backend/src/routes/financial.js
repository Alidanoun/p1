const express = require('express');
const financialApprovalController = require('../controllers/financialApprovalController');
const { authenticateToken: authMiddleware, isAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * 🔒 Financial Control Tower Routes
 * Restricted to Admins only.
 */

const BranchAccessMiddleware = require('../middleware/branchAccessMiddleware');

const financialReportController = require('../controllers/financialReportController');

router.get('/approvals/pending', authMiddleware, BranchAccessMiddleware, financialApprovalController.getPendingApprovals);
router.get('/approvals/stats', authMiddleware, BranchAccessMiddleware, financialApprovalController.getApprovalStats);
router.post('/close-day', authMiddleware, isAdmin, financialApprovalController.closeDay);
router.post('/approvals/:id/approve', authMiddleware, BranchAccessMiddleware, financialApprovalController.approve);
router.post('/approvals/:id/reject', authMiddleware, BranchAccessMiddleware, financialApprovalController.reject);

// 📈 Reporting & Snapshots (Step 2 & 3 Implementation)
router.get('/reports/overview', authMiddleware, BranchAccessMiddleware, financialReportController.getBranchOverview);
router.get('/reports/historical', authMiddleware, BranchAccessMiddleware, financialReportController.getHistoricalReports);
router.get('/reports/global', authMiddleware, isAdmin, financialReportController.getGlobalDashboard);
router.post('/reports/snapshot/trigger', authMiddleware, isAdmin, financialReportController.triggerSnapshot);

module.exports = router;
