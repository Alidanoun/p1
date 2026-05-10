const express = require('express');
const financialApprovalController = require('../controllers/financialApprovalController');
const { authenticateToken: authMiddleware, isAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * 🔒 Financial Control Tower Routes
 * Restricted to Admins only.
 */

const BranchAccessMiddleware = require('../middleware/branchAccessMiddleware');

router.get('/approvals/pending', authMiddleware, BranchAccessMiddleware, financialApprovalController.getPendingApprovals);
router.get('/approvals/stats', authMiddleware, BranchAccessMiddleware, financialApprovalController.getApprovalStats);
router.post('/close-day', authMiddleware, isAdmin, financialApprovalController.closeDay);
router.post('/approvals/:id/approve', authMiddleware, BranchAccessMiddleware, financialApprovalController.approve);
router.post('/approvals/:id/reject', authMiddleware, BranchAccessMiddleware, financialApprovalController.reject);

module.exports = router;
