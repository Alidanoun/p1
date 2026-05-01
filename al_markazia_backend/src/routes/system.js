const express = require('express');
const router = express.Router();
const configService = require('../services/configService');

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

// Admin: Refresh Cache
router.post('/config/refresh', async (req, res) => {
  try {
    const config = await configService.refreshCache();
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
