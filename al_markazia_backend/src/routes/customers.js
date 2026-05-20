const express = require('express');
const { validateId } = require('../utils/security');

const router = express.Router();
const customerController = require('../controllers/customerController');
const { authenticateToken, isAdmin, requireRoles } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

// CRM Security Layer: Rate limiting for sensitive operations
const unblockRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: { success: false, error: { message: 'محاولات كثيرة جداً، يرجى الانتظار دقيقة واحدة.', code: 'RATE_LIMIT_EXCEEDED' } }
});

// 🛡️ Strict OTP request limit: 3 per hour per IP+Phone
const otpRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { success: false, error: { message: 'محاولات كثيرة، حاول بعد ساعة', code: 'OTP_LIMIT' } },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req)}:${req.body?.phone || ''}`
});

// 🛡️ OTP verification limit: 10 per hour per IP
const otpVerifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, error: { message: 'محاولات كثيرة، يرجى طلب رمز جديد', code: 'VERIFY_LIMIT' } }
});

// 🛡️ Password change limit: 5 per hour per IP
const changePasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, error: { message: 'محاولات كثيرة لتغيير كلمة المرور', code: 'PASSWORD_CHANGE_LIMIT' } }
});

// Endpoint to update device FCM token (Secured via JWT)
router.post('/fcm-token', authenticateToken, customerController.updateFcmToken);

// 🔐 Customer Account Management (Self-Service)
router.put('/profile', authenticateToken, customerController.updateProfile);
router.post('/change-password', changePasswordLimiter, authenticateToken, customerController.changePassword);
router.post('/delete-account', authenticateToken, customerController.deleteAccount);

// 🔐 New OTP-based Secure Authentication Flow
router.post('/auth/request-login-otp', otpRequestLimiter, customerController.requestLoginOtp);
router.post('/auth/login', otpVerifyLimiter, customerController.loginCustomer);
router.post('/auth/request-register-otp', otpRequestLimiter, customerController.requestRegistrationOtp);
router.post('/auth/register', otpVerifyLimiter, customerController.registerCustomer);


// Admin Blacklist/Risk Management Management (CRM Tier)
const CRM_ROLES = ['admin'];

router.get('/blacklisted', authenticateToken, requireRoles(CRM_ROLES), customerController.getBlacklistedCustomers);
router.get('/blacklist/count', authenticateToken, requireRoles(CRM_ROLES), customerController.getBlacklistCount);
router.patch('/:id/block', authenticateToken, requireRoles(CRM_ROLES), validateId(), customerController.blockCustomer);
router.patch('/:id/unblock', authenticateToken, requireRoles(CRM_ROLES), validateId(), unblockRateLimit, customerController.unblockCustomer);

module.exports = router;
