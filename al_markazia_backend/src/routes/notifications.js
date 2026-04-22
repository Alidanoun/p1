const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken, isAdmin } = require('../middleware/auth');

// Secure Identity Route: Get my notifications
router.get('/my-notifications', authenticateToken, notificationController.getMyNotifications);

// Legacy/Admin Route: Get notifications by phone or for admin
router.get('/', (req, res, next) => {
  if (req.query.phone) return next();
  return authenticateToken(req, res, next);
}, notificationController.getNotifications);

// Mark as read (Secure + Legacy)
router.put('/read-all', (req, res, next) => {
  if (req.query.phone) return next();
  return authenticateToken(req, res, next);
}, notificationController.markAllAsRead);

router.put('/:id/read', authenticateToken, notificationController.markAsRead);

// Protect the broadcast so only admins can do it
router.post('/broadcast', authenticateToken, isAdmin, notificationController.broadcast);

module.exports = router;
