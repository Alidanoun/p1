const express = require('express');
const router = express.Router();
const notificationDashboardController = require('../controllers/notificationDashboardController');
const { isAdmin } = require('../middleware/auth');

/**
 * 🛡️ Notification Admin Routes
 */
router.get('/stats', isAdmin, (req, res) => notificationDashboardController.getStats(req, res));
router.post('/reset-stats', isAdmin, (req, res) => notificationDashboardController.resetStats(req, res));

module.exports = router;
