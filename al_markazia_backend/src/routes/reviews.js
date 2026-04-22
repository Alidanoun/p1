const express = require('express');
const { 
  submitReview, 
  getItemReviews, 
  getAllReviews, 
  toggleApproval, 
  deleteReview 
} = require('../controllers/reviewController');
const { authenticateToken, isAdmin } = require('../middleware/auth');

const router = express.Router();

// Public routes for mobile App
router.post('/', submitReview);
router.get('/item/:itemId', getItemReviews);

// Protected routes for Admin Panel
router.get('/', authenticateToken, isAdmin, getAllReviews);
router.put('/:id/approve', authenticateToken, isAdmin, toggleApproval);
router.delete('/:id', authenticateToken, isAdmin, deleteReview);

module.exports = router;
