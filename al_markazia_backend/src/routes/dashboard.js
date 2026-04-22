const express = require('express');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { getLiveMetrics, getLiveOrders } = require('../controllers/dashboardController');

const router = express.Router();

/**
 * 📊 Event-Driven Dashboard Routes
 * Purpose: Provide high-speed read access to system projections.
 */

router.get('/metrics', authenticateToken, isAdmin, getLiveMetrics);
router.get('/orders', authenticateToken, isAdmin, getLiveOrders);

module.exports = router;
