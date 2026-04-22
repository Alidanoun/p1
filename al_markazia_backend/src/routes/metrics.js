const express = require('express');
const router = express.Router();
const metricsController = require('../controllers/metricsController');
const { authenticateToken, isAdmin } = require('../middleware/auth');

/**
 * Metrics Routes - Granite Architecture
 * Protected by Admin Middleware.
 */

// Summary of last 24h performance
router.get('/summary', authenticateToken, isAdmin, metricsController.getMetricsSummary);

// High-Performance Dashboard Metrics
router.get('/dashboard-metrics', authenticateToken, isAdmin, metricsController.getDashboardMetrics);

// Deep Dive into specific metrics (cancellations, notifications)
router.get('/drilldown', authenticateToken, isAdmin, metricsController.getDrillDown);

module.exports = router;
