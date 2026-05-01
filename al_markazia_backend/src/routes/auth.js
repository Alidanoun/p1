const express = require('express');
const { login, register, verifyRegistration, forgotPassword, resetPassword, refreshToken, logout, getMe, getSessions } = require('../controllers/authController');
const { authLimiter, forgotPasswordLimiter } = require('../middleware/rateLimiter');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/login', authLimiter, login);
router.post('/register', authLimiter, register);
router.post('/verify-registration', authLimiter, verifyRegistration);
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/reset-password', forgotPasswordLimiter, resetPassword);
router.post('/refresh', authLimiter, refreshToken);
router.post('/logout', authenticateToken, logout);
router.get('/me', authenticateToken, getMe);
router.get('/sessions', authenticateToken, getSessions);

module.exports = router;
