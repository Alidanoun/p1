const express = require('express');
const { getStatus, getSchedule, updateSchedule, toggleEmergencyClose, subscribeToReopen } = require('../controllers/restaurantController');
const { authenticateToken, isAdmin, isManager } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissionMiddleware');
const { withCache, invalidateCache } = require('../middleware/cacheMiddleware');

const router = express.Router();

/**
 * @route GET /api/restaurant/status
 * @desc Get current open/closed status (Public)
 */
router.get('/status', withCache('restaurant_status'), getStatus);

/**
 * @route GET /api/restaurant/schedule
 * @desc Get full schedule and settings (Admin / Branch Manager)
 */
router.get('/schedule', authenticateToken, isManager, checkPermission('canModifyWorkHours', 'VIEW'), getSchedule);

/**
 * @route POST /api/restaurant/schedule
 * @desc Update schedule and settings (Admin / Branch Manager)
 */
router.post('/schedule', authenticateToken, isManager, checkPermission('canModifyWorkHours', 'EDIT_PIN'), invalidateCache('restaurant_status'), updateSchedule);

/**
 * @route POST /api/restaurant/emergency-close
 * @desc Toggle emergency close (Admin / Branch Manager with permission)
 */
router.post('/emergency-close', authenticateToken, isManager, checkPermission('canToggleLiveMode'), invalidateCache('restaurant_status'), toggleEmergencyClose);

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

