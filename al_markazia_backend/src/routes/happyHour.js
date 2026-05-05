const express = require('express');
const router = express.Router();
const hhController = require('../controllers/happyHourController');
const { authenticateToken, isAdmin } = require('../middleware/auth');

/**
 * @route GET /api/happyhour/status/:branchId
 * @desc Get current HH status (Public)
 */
router.get('/status/:branchId', hhController.getBranchStatus);

/**
 * @route GET /api/happyhour/admin/stats
 * @desc Get diagnostic stats (Admin)
 */
router.get('/admin/stats', authenticateToken, isAdmin, hhController.getAdminStats);

/**
 * @route POST /api/happyhour/admin/reload
 * @desc Global reload signal (Admin)
 */
router.post('/admin/reload', authenticateToken, isAdmin, hhController.reloadConfigs);

/**
 * @route POST /api/happyhour/admin/create
 * @desc Create new session (Admin)
 */
router.post('/admin/create', authenticateToken, isAdmin, hhController.createConfig);

module.exports = router;
