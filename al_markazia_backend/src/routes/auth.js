const express = require('express');
const { login, register, verifyRegistration, forgotPassword, resetPassword, refreshToken, logout, getMe } = require('../controllers/authController');
const { authLimiter } = require('../middleware/rateLimiter');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/login', authLimiter, login);
router.post('/register', authLimiter, register);
router.post('/verify-registration', authLimiter, verifyRegistration);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.post('/refresh', authLimiter, refreshToken);
router.post('/logout', authenticateToken, logout);
router.get('/me', authenticateToken, getMe);

module.exports = router;
