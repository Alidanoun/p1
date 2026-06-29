const express = require('express');
const router = express.Router();
const configService = require('../services/configService');
const systemController = require('../controllers/systemController');
const { authenticateToken, isAdmin, hasPermission } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissionMiddleware');
const { PERMISSIONS } = require('../config/permissions');
const { searchLimiter } = require('../middleware/rateLimiter');

/**
 * ⚙️ System Configuration Routes
 */

// Public: Client-safe configuration only (no sensitive data)
router.get('/config', async (req, res) => {
  try {
    const [config, announcementText] = await Promise.all([
      configService.getFullConfig(),
      configService.getAnnouncementText()
    ]);
    // Strip sensitive/internal fields — return only what the client app needs
    const publicConfig = {
      announcementText,
      business: {
        taxRate: config.business?.taxRate,
        currency: config.business?.currency,
        minOrderValue: config.business?.minOrderValue,
        maxCancellationReasonLength: config.business?.maxCancellationReasonLength,
        freeCancelWindowMinutes: config.business?.freeCancelWindowMinutes,
        spamCancelLimit: config.business?.spamCancelLimit,
        spamTimeWindowMinutes: config.business?.spamTimeWindowMinutes,
      },
      delivery: {
        defaultFee: config.delivery?.defaultFee,
        isActive: config.delivery?.isActive,
      },
      restaurant: {
        isEmergencyClosed: config.restaurant?.isEmergencyClosed,
        lastOrderMinutesBeforeClose: config.restaurant?.lastOrderMinutesBeforeClose,
        timezone: config.restaurant?.timezone,
      },
      workingHours: config.workingHours || [],
    };
    res.json({ success: true, data: publicConfig });
  } catch (err) {
    res.status(500).json({ success: false, error: 'CONFIG_UNAVAILABLE' });
  }
});

// Admin: Full configuration (RBAC v3)
router.get('/config/full', authenticateToken, checkPermission('settings', 'VIEW'), hasPermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE), async (req, res) => {
  try {
    const config = await configService.getFullConfig();
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, error: 'CONFIG_UNAVAILABLE' });
  }
});

// Admin: Refresh Cache (RBAC v3)
router.post('/config/refresh', authenticateToken, checkPermission('settings', 'EDIT_PIN'), hasPermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE), async (req, res) => {
  try {
    const config = await configService.refreshCache();
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 📊 Frontend Error Logging — Rate limited + input sanitized
 */
router.post('/logs/frontend-error', searchLimiter, async (req, res) => {
  const logger = require('../utils/logger');

  // Input size limit — prevent log flooding
  const bodyStr = JSON.stringify(req.body);
  if (bodyStr.length > 4096) {
    return res.status(400).json({ success: false, error: 'PAYLOAD_TOO_LARGE', code: 'PAYLOAD_TOO_LARGE' });
  }

  // Sanitize — only allow safe fields
  const safeFields = ['message', 'stack', 'component', 'url', 'userAgent', 'severity'];
  const sanitized = {};
  for (const field of safeFields) {
    if (req.body[field] && typeof req.body[field] === 'string') {
      sanitized[field] = req.body[field].substring(0, 2000);
    }
  }

  logger.error('[FRONTEND_CRASH]', {
    ...sanitized,
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
