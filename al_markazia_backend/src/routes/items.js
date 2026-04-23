const express = require('express');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');
const { getAllItems, searchItems, createItem, updateItem, deleteItem, updateFeaturedItems, toggleExclusion } = require('../controllers/itemController');
const { searchLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.get('/', getAllItems);
router.get('/search', searchLimiter, searchItems);
router.post('/', authenticateToken, isAdmin, uploadImage('image'), createItem);
router.put('/featured', authenticateToken, isAdmin, updateFeaturedItems);
router.patch('/:id/exclude', authenticateToken, isAdmin, toggleExclusion);
router.put('/:id', authenticateToken, isAdmin, uploadImage('image'), updateItem);
router.patch('/:id/options/toggle', authenticateToken, isAdmin, (req, res, next) => {
  // New specific endpoint for availability toggling to avoid "wipe and rebuild" complexity
  require('../controllers/itemController').toggleOptionAvailability(req, res, next);
});
router.delete('/:id', authenticateToken, isAdmin, deleteItem);

module.exports = router;
