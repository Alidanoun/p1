const express = require('express');
const { login, register, verifyRegistration, refreshToken, logout, getMe } = require('../controllers/authController');
const { authLimiter } = require('../middleware/rateLimiter');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/login', authLimiter, login);
router.post('/register', authLimiter, register);
router.post('/verify-registration', authLimiter, verifyRegistration);
router.post('/refresh', authLimiter, refreshToken);
router.post('/logout', authenticateToken, logout);
router.get('/me', authenticateToken, getMe);

module.exports = router;
