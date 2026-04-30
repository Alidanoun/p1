const express = require('express');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { getSettings, updateSetting, updateBulkSettings } = require('../controllers/settingsController');

const router = express.Router();

// Admin only routes
router.get('/', authenticateToken, isAdmin, getSettings);
router.post('/', authenticateToken, isAdmin, updateSetting);
router.put('/', authenticateToken, isAdmin, updateBulkSettings);

module.exports = router;
