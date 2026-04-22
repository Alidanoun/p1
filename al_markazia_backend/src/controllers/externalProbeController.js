const logger = require('../utils/logger');

/**
 * 🧪 External Health Probe (Tier 0)
 * Purpose: Provides a lightweight endpoint for external uptime monitors.
 * This MUST NOT depend on DB or Redis to respond, ensuring we can detect
 * if the process itself is alive even when dependencies are down.
 */
class ExternalProbeController {
  async pings(req, res) {
    // 🛡️ API Key Guard (Optional but recommended for SRE)
    const probeKey = req.headers['x-probe-key'];
    if (process.env.PROBE_KEY && probeKey !== process.env.PROBE_KEY) {
      return res.status(403).json({ error: 'UNAUTHORIZED_PROBE' });
    }

    const health = {
      status: 'UP',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage().rss / 1024 / 1024,
      version: process.version
    };

    return res.status(200).json(health);
  }
}

module.exports = new ExternalProbeController();
