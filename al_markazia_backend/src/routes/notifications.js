const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken, isAdmin } = require('../middleware/auth');

// ✅ Customer: own notifications
router.get('/my-notifications', authenticateToken, notificationController.getMyNotifications);

// ✅ Admin: all admin notifications
router.get('/', authenticateToken, isAdmin, notificationController.getAdminNotifications);

// ✅ Mark single as read (ownership-checked)
router.put('/:id/read', authenticateToken, notificationController.markAsRead);

// ✅ Mark all as read (uses JWT identity only)
router.put('/read-all', authenticateToken, notificationController.markAllAsRead);

// ✅ Admin broadcast
router.post('/broadcast', authenticateToken, isAdmin, notificationController.broadcast);

module.exports = router;
