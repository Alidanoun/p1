const express = require('express');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getAllItems, searchItems, createItem, updateItem, deleteItem, updateFeaturedItems, toggleExclusion } = require('../controllers/itemController');
const { searchLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.get('/', getAllItems);
router.get('/search', searchLimiter, searchItems);
router.post('/', authenticateToken, upload.single('image'), createItem);
router.put('/featured', authenticateToken, updateFeaturedItems);
router.patch('/:id/exclude', authenticateToken, toggleExclusion);
router.put('/:id', authenticateToken, upload.single('image'), updateItem);
router.patch('/:id/options/toggle', authenticateToken, (req, res, next) => {
  // New specific endpoint for availability toggling to avoid "wipe and rebuild" complexity
  require('../controllers/itemController').toggleOptionAvailability(req, res, next);
});
router.delete('/:id', authenticateToken, deleteItem);

module.exports = router;
