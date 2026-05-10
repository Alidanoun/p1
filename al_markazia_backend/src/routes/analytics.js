const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { authenticateToken, isAdmin } = require('../middleware/auth');

const BranchAccessMiddleware = require('../middleware/branchAccessMiddleware');

// 📊 Operational Reporting
router.get('/branch/report/today', authenticateToken, BranchAccessMiddleware, analyticsController.getBranchDailyReport);

// 📈 Advanced Analytics Dashboard
router.get('/dashboard', authenticateToken, BranchAccessMiddleware, analyticsController.getDashboardStats);

module.exports = router;
