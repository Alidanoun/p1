const express = require('express');
const router = express.Router();
const ratingController = require('../controllers/ratingController');
const { authenticateToken } = require('../middleware/auth');
const fingerprintGuard = require('../middleware/fingerprintGuard');
const { validateRating } = require('../middleware/ratingValidation');

/**
 * ⭐ Rating & Review Routes (Phase 1)
 */

// Public: View reviews and stats
router.get('/item/:itemId', (req, res) => ratingController.getItemReviews(req, res));
router.get('/stats/:type/:id', authenticateToken, (req, res) => ratingController.getStats(req, res));

// Protected: Submit reviews
router.post(
  '/',
  authenticateToken,
  fingerprintGuard,
  validateRating,
  (req, res) => ratingController.submit(req, res)
);

module.exports = router;
