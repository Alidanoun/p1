const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { authenticateToken, isAdmin, requireRoles } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// CRM Security Layer: Rate limiting for sensitive operations
const unblockRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per IP
  message: { success: false, error: { message: 'محاولات كثيرة جداً، يرجى الانتظار دقيقة واحدة.', code: 'RATE_LIMIT_EXCEEDED' } }
});

// Endpoint to update device FCM token (Secured via JWT)
router.post('/fcm-token', authenticateToken, customerController.updateFcmToken);

// Authentication endpoints
router.post('/login', customerController.loginCustomer);
router.post('/register', customerController.registerCustomer);

// Admin Blacklist/Risk Management Management (CRM Tier)
const CRM_ROLES = ['admin', 'super_admin'];

router.get('/blacklisted', authenticateToken, requireRoles(CRM_ROLES), customerController.getBlacklistedCustomers);
router.get('/blacklist/count', authenticateToken, requireRoles(CRM_ROLES), customerController.getBlacklistCount);
router.patch('/:id/block', authenticateToken, requireRoles(CRM_ROLES), customerController.blockCustomer);
router.patch('/:id/unblock', authenticateToken, requireRoles(CRM_ROLES), unblockRateLimit, customerController.unblockCustomer);

module.exports = router;
