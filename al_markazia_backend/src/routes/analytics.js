const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissionMiddleware');

const BranchAccessMiddleware = require('../middleware/branchAccessMiddleware');

// 📊 Operational Reporting
router.get('/branch/report/today', authenticateToken, checkPermission('advancedAnalytics', 'VIEW'), BranchAccessMiddleware, analyticsController.getBranchDailyReport);

// 📈 Advanced Analytics Dashboard
router.get('/dashboard', authenticateToken, checkPermission('advancedAnalytics', 'VIEW'), BranchAccessMiddleware, analyticsController.getDashboardStats);

module.exports = router;

