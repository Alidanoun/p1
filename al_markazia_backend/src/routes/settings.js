const express = require('express');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { getSettings, updateSetting, updateBulkSettings, getAuditLogs, updateAdminCredentials } = require('../controllers/settingsController');

const router = express.Router();

// Admin only routes
router.get('/', authenticateToken, isAdmin, getSettings);
router.post('/', authenticateToken, isAdmin, updateSetting);
router.put('/', authenticateToken, isAdmin, updateBulkSettings);

// Audit logs
router.get('/audit', authenticateToken, isAdmin, getAuditLogs);

// Admin Credentials
router.put('/credentials', authenticateToken, isAdmin, updateAdminCredentials);

module.exports = router;
