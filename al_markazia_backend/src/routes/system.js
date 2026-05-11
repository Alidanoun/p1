const express = require('express');
const router = express.Router();
const configService = require('../services/configService');
const systemController = require('../controllers/systemController');
const { authenticateToken, isAdmin, hasPermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/permissions');

/**
 * ⚙️ System Configuration Routes
 * Public or Authenticated fetch for system-wide business rules.
 */

router.get('/config', async (req, res) => {
  try {
    const config = await configService.getFullConfig();
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Refresh Cache (RBAC v3)
router.post('/config/refresh', authenticateToken, hasPermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE), async (req, res) => {
  try {
    const config = await configService.refreshCache();
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 📊 Frontend Error Logging
 * Receives crashes from ErrorBoundary.jsx
 */
router.post('/logs/frontend-error', async (req, res) => {
  const logger = require('../utils/logger');
  logger.error('[FRONTEND_CRASH]', {
    ...req.body,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });
  res.json({ success: true });
});

/**
 * 🛡️ Diagnostic Control Plane
 */
router.get('/diagnostics', authenticateToken, isAdmin, systemController.getSystemDiagnostics);
router.get('/event-health', authenticateToken, isAdmin, systemController.getEventHealth);

module.exports = router;
