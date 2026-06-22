const express = require('express');
const { authenticateToken, isAdmin, hasPermission } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissionMiddleware');
const { PERMISSIONS } = require('../config/permissions');

const { 
  getSettings, updateSetting, updateBulkSettings, 
  getAuditLogs, updateAdminCredentials, updateAdvancedConfig,
  updateBranchCredentials
} = require('../controllers/settingsController');

const router = express.Router();

// Admin only routes
router.get('/', authenticateToken, isAdmin, checkPermission('settings', 'VIEW'), hasPermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE), getSettings);
router.post('/', authenticateToken, isAdmin, checkPermission('settings', 'EDIT_PIN'), hasPermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE), updateSetting);
router.put('/', authenticateToken, isAdmin, checkPermission('settings', 'EDIT_PIN'), hasPermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE), updateBulkSettings);
router.patch('/advanced', authenticateToken, isAdmin, checkPermission('settings', 'EDIT_PIN'), hasPermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE), updateAdvancedConfig);

// Audit logs
router.get('/audit', authenticateToken, isAdmin, checkPermission('settings', 'VIEW'), hasPermission(PERMISSIONS.SYSTEM_VIEW_LOGS), getAuditLogs);

// Admin Credentials
router.put('/credentials', authenticateToken, isAdmin, checkPermission('settings', 'EDIT_PIN'), hasPermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE), updateAdminCredentials);

// Branch Credentials
router.put('/branch-credentials', authenticateToken, isAdmin, checkPermission('settings', 'EDIT_PIN'), hasPermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE), updateBranchCredentials);

module.exports = router;
