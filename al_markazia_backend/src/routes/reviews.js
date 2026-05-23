const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { authenticateToken, isManager } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissionMiddleware');
const { reviewLimiter, flagLimiter } = require('../middleware/rateLimiter');
const { validateOrderRating } = require('../middleware/orderValidation');

// 📖 Public: Read approved reviews for an item
router.get('/item/:itemId', reviewController.getItemReviews);

// 🔒 Customer: Submit a review (Verified Purchase + Rate Limited)
router.post('/', authenticateToken, reviewLimiter, validateOrderRating, reviewController.submitReview);

// 🚩 Customer: Report/Flag a review for moderation
router.patch('/:id', authenticateToken, reviewLimiter, reviewController.updateReview);
router.post('/:id/flag', authenticateToken, flagLimiter, reviewController.flagReview);

// 👮 Admin/Manager: Consolidated review management
router.get('/stats', authenticateToken, isManager, checkPermission('reviews', 'VIEW'), reviewController.getReviewStats);
router.get('/', authenticateToken, isManager, checkPermission('reviews', 'VIEW'), reviewController.getAllReviews);
router.put('/:id/approve', authenticateToken, isManager, checkPermission('reviews', 'EDIT_PIN'), reviewController.toggleApproval);
router.delete('/:id', authenticateToken, isManager, checkPermission('reviews', 'EDIT_PIN'), reviewController.deleteReview);

module.exports = router;

