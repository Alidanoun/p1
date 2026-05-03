const express = require('express');
const { login, register, verifyRegistration, forgotPassword, resetPassword, refreshToken, logout, getMe, getSessions } = require('../controllers/authController');
const { loginLimiter, otpLimiter, refreshTokenLimiter } = require('../middleware/advancedRateLimiter');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/login', loginLimiter, login);
router.post('/register', otpLimiter, register);
router.post('/verify-registration', otpLimiter, verifyRegistration);
router.post('/forgot-password', otpLimiter, forgotPassword);
router.post('/reset-password', otpLimiter, resetPassword);
router.post('/refresh', refreshTokenLimiter, refreshToken);
router.post('/logout', authenticateToken, logout);
router.get('/me', authenticateToken, getMe);
router.get('/sessions', authenticateToken, getSessions);

module.exports = router;
