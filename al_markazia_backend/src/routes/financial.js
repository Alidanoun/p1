const express = require('express');
const financialApprovalController = require('../controllers/financialApprovalController');
const { authenticateToken: authMiddleware, isAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * 🔒 Financial Control Tower Routes
 * Restricted to Admins only.
 */

router.get('/approvals/pending', authMiddleware, isAdmin, financialApprovalController.getPendingApprovals);
router.get('/approvals/stats', authMiddleware, isAdmin, financialApprovalController.getApprovalStats);
router.post('/close-day', authMiddleware, isAdmin, financialApprovalController.closeDay);
router.post('/approvals/:id/approve', authMiddleware, isAdmin, financialApprovalController.approve);
router.post('/approvals/:id/reject', authMiddleware, isAdmin, financialApprovalController.reject);

module.exports = router;
