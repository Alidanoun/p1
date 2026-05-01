const express = require('express');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { 
  getSettings, updateSetting, updateBulkSettings, 
  getAuditLogs, updateAdminCredentials, updateAdvancedConfig 
} = require('../controllers/settingsController');

const router = express.Router();

// Admin only routes
router.get('/', authenticateToken, isAdmin, getSettings);
router.post('/', authenticateToken, isAdmin, updateSetting);
router.put('/', authenticateToken, isAdmin, updateBulkSettings);
router.patch('/advanced', authenticateToken, isAdmin, updateAdvancedConfig);

// Audit logs
router.get('/audit', authenticateToken, isAdmin, getAuditLogs);

// Admin Credentials
router.put('/credentials', authenticateToken, isAdmin, updateAdminCredentials);

module.exports = router;
