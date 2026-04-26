const express = require('express');
const { getDashboardStats } = require('../controllers/analyticsController');
const { authenticateToken, requireRoles } = require('../middleware/auth');

const router = express.Router();

// 🛡️ Only Admins can see analytics
router.get('/dashboard', authenticateToken, requireRoles(['admin', 'manager']), getDashboardStats);

module.exports = router;
