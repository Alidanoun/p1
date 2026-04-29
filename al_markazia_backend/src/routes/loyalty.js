const express = require('express');
const router = express.Router();
const loyaltyController = require('../controllers/loyaltyController');
const { authenticateToken: authMiddleware, isAdmin: adminMiddleware } = require('../middleware/auth');

/**
 * 🎁 Loyalty Routes
 * Secured for Admin use only.
 */

router.get('/settings', authMiddleware, adminMiddleware, loyaltyController.getSettings);
router.patch('/settings', authMiddleware, adminMiddleware, loyaltyController.updateSettings);

module.exports = router;
