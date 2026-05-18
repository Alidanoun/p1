const express = require('express');
const { getStatus, getSchedule, updateSchedule, toggleEmergencyClose, subscribeToReopen } = require('../controllers/restaurantController');
const { authenticateToken, isAdmin, isManager } = require('../middleware/auth');
const { withCache, invalidateCache } = require('../middleware/cacheMiddleware');

const router = express.Router();

/**
 * @route GET /api/restaurant/status
 * @desc Get current open/closed status (Public)
 */
router.get('/status', withCache('restaurant_status'), getStatus);

/**
 * @route GET /api/restaurant/schedule
 * @desc Get full schedule and settings (Admin Only)
 */
router.get('/schedule', authenticateToken, isAdmin, getSchedule);

/**
 * @route POST /api/restaurant/schedule
 * @desc Update schedule and settings (Admin Only)
 */
router.post('/schedule', authenticateToken, isAdmin, invalidateCache('restaurant_status'), updateSchedule);

router.post('/emergency-close', authenticateToken, isManager, invalidateCache('restaurant_status'), toggleEmergencyClose);

/**
 * @route POST /api/restaurant/subscribe
 * @desc Subscribe to notification when restaurant reopens
 */
router.post('/subscribe', (req, res, next) => {
  // Optional auth
  if (req.headers.authorization) return authenticateToken(req, res, next);
  next();
}, subscribeToReopen);

module.exports = router;
