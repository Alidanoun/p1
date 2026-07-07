const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { authenticateToken, isManager } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissionMiddleware');
const { reviewLimiter, flagLimiter } = require('../middleware/rateLimiter');
const { validateOrderRating } = require('../middleware/orderValidation');
const BranchAccessMiddleware = require('../middleware/branchAccessMiddleware');

// 📖 Public: Read approved reviews for an item
router.get('/item/:itemId', reviewController.getItemReviews);

// 🔒 Customer: Submit a review (Verified Purchase + Rate Limited)
router.post('/', authenticateToken, reviewLimiter, validateOrderRating, reviewController.submitReview);

// 🚩 Customer: Report/Flag a review for moderation
router.patch('/:id', authenticateToken, reviewLimiter, reviewController.updateReview);
router.post('/:id/flag', authenticateToken, flagLimiter, reviewController.flagReview);

// 👮 Admin/Manager: Consolidated review management
router.get('/stats', authenticateToken, isManager, checkPermission('reviews', 'VIEW'), BranchAccessMiddleware, reviewController.getReviewStats);
router.get('/', authenticateToken, isManager, checkPermission('reviews', 'VIEW'), BranchAccessMiddleware, reviewController.getAllReviews);
router.put('/:id/approve', authenticateToken, isManager, checkPermission('reviews', 'EDIT_PIN'), BranchAccessMiddleware, reviewController.toggleApproval);
router.post('/:id/reply', authenticateToken, isManager, checkPermission('reviews', 'EDIT_PIN'), BranchAccessMiddleware, reviewController.addReply);
router.delete('/:id', authenticateToken, isManager, checkPermission('reviews', 'EDIT_PIN'), BranchAccessMiddleware, reviewController.deleteReview);

module.exports = router;

