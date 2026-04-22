const express = require('express');
const { login, refreshToken } = require('../controllers/authController');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/login', authLimiter, login);
router.post('/refresh', authLimiter, refreshToken);

module.exports = router;
