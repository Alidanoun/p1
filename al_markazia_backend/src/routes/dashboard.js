const express = require('express');
const { authenticateToken, isManager } = require('../middleware/auth');
const { getLiveMetrics, getLiveOrders } = require('../controllers/dashboardController');

const router = express.Router();

/**
 * 📊 Event-Driven Dashboard Routes
 * Purpose: Provide high-speed read access to system projections.
 */

router.get('/metrics', authenticateToken, isManager, getLiveMetrics);
router.get('/orders', authenticateToken, isManager, getLiveOrders);

module.exports = router;
