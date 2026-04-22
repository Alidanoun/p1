const express = require('express');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { getSettings, updateSetting } = require('../controllers/settingsController');

const router = express.Router();

// Admin only routes
router.get('/', authenticateToken, isAdmin, getSettings);
router.post('/', authenticateToken, isAdmin, updateSetting);

module.exports = router;
