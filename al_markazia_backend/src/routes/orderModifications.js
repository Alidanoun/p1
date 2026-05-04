const express = require('express');
const router = express.Router();
const controller = require('../controllers/orderModificationController');
const { authenticateToken, requireRoles } = require('../middleware/auth');

/**
 * 🛠️ Order Modification Routes
 * Lifecycle: Preview -> Request -> Apply
 */

// 1. Preview changes (Read-only)
router.post(
  '/:id/preview', 
  authenticateToken, 
  requireRoles(['admin']), 
  controller.preview
);

// 2. Request modification (Creates pending event)
router.post(
  '/:id/request', 
  authenticateToken, 
  requireRoles(['admin']), 
  controller.request
);

// 3. Apply/Confirm modification
router.post(
  '/events/:eventId/apply', 
  authenticateToken, 
  requireRoles(['admin']), 
  controller.apply
);

module.exports = router;
