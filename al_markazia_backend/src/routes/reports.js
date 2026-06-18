const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticateToken, hasPermission } = require('../middleware/auth');

// Require either MANAGE_SETTINGS or VIEW_REPORTS permission (assume VIEW_REPORTS or admin)
router.use(authenticateToken);

router.get('/daily', reportController.getDailyReports);
router.get('/top-items', reportController.getTopItems);

module.exports = router;
