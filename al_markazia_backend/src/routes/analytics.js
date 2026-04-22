const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { authenticateToken, isAdmin } = require('../middleware/auth');

/**
 * Analytics Routes - Lockdown for Admins Only
 */
router.get('/dashboard-stats', authenticateToken, isAdmin, analyticsController.getDashboardStats);

module.exports = router;
