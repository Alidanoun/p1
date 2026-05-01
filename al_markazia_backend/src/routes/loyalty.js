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

// 📱 Mobile App Endpoints
router.get('/profile', authMiddleware, loyaltyController.getMyLoyaltyProfile);
router.post('/share-product', authMiddleware, loyaltyController.rewardSocialShare);

// 🛒 Rewards Store (Admin)
router.get('/rewards', authMiddleware, adminMiddleware, loyaltyController.getAllRewards);
router.post('/rewards', authMiddleware, adminMiddleware, loyaltyController.createReward);
router.put('/rewards/:id', authMiddleware, adminMiddleware, loyaltyController.updateReward);
router.delete('/rewards/:id', authMiddleware, adminMiddleware, loyaltyController.deleteReward);

// 🛒 Rewards Store (Mobile App)
router.get('/store', loyaltyController.getActiveRewards); // Public or Auth
router.post('/store/claim', authMiddleware, loyaltyController.claimReward);
router.get('/my-rewards', authMiddleware, loyaltyController.getMyRewards);

module.exports = router;
