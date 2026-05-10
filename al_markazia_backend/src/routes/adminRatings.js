const express = require('express');
const router = express.Router();
const adminModerationController = require('../controllers/adminModerationController');
const { authenticateToken, isAdmin } = require('../middleware/auth');

/**
 * 🛡️ Admin Ratings Moderation Routes (Phase 2)
 */
router.get('/pending', authenticateToken, isAdmin, (req, res) => adminModerationController.getPendingReviews(req, res));
router.patch('/:id/status', authenticateToken, isAdmin, (req, res) => adminModerationController.updateStatus(req, res));
router.post('/:id/reply', authenticateToken, isAdmin, (req, res) => adminModerationController.postReply(req, res));

module.exports = router;
