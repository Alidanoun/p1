const express = require('express');
const { authenticateToken, isManager } = require('../middleware/auth');
const BranchAccessMiddleware = require('../middleware/branchAccessMiddleware');
const { getLiveMetrics, getLiveOrders } = require('../controllers/dashboardController');

const router = express.Router();

/**
 * 📊 Event-Driven Dashboard Routes
 * Purpose: Provide high-speed read access to system projections.
 */

router.use(authenticateToken);
router.use(isManager);
router.use(BranchAccessMiddleware);

router.get('/metrics', getLiveMetrics);
router.get('/orders', getLiveOrders);

module.exports = router;
