const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { reviewLimiter, flagLimiter } = require('../middleware/rateLimiter');

// 📖 Public: Read approved reviews for an item
router.get('/item/:itemId', reviewController.getItemReviews);

// 🔒 Customer: Submit a review (Verified Purchase + Rate Limited)
router.post('/', authenticateToken, reviewLimiter, reviewController.submitReview);

// 🚩 Customer: Report/Flag a review for moderation
router.post('/:id/flag', authenticateToken, flagLimiter, reviewController.flagReview);

// 👮 Admin: Consolidated review management
router.get('/', authenticateToken, isAdmin, reviewController.getAllReviews);
router.put('/:id/approve', authenticateToken, isAdmin, reviewController.toggleApproval);
router.delete('/:id', authenticateToken, isAdmin, reviewController.deleteReview);

module.exports = router;
