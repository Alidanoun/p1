const express = require('express');
const router = express.Router();
const loyaltyController = require('../controllers/loyaltyController');
const { authenticateToken: authMiddleware, isAdmin: adminMiddleware } = require('../middleware/auth');

/**
 * 🎁 Loyalty Routes
 * Secured for Admin use only.
 */

router.get('/status', loyaltyController.getStatus);
router.get('/settings', authMiddleware, adminMiddleware, loyaltyController.getSettings);
router.post('/start-now', authMiddleware, adminMiddleware, loyaltyController.startNow);
router.post('/stop-now', authMiddleware, adminMiddleware, loyaltyController.stopNow);
router.patch('/settings', authMiddleware, adminMiddleware, loyaltyController.updateSettings);

module.exports = router;
