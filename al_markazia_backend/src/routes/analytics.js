const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { authenticateToken, isAdmin } = require('../middleware/auth');

// 📊 Operational Reporting
router.get('/branch/report/today', authenticateToken, analyticsController.getBranchDailyReport);

// 📈 Advanced Analytics Dashboard
router.get('/dashboard', authenticateToken, isAdmin, analyticsController.getDashboardStats);

module.exports = router;
