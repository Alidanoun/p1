const http = require('http');
const logger = require('../utils/logger');
const redis = require('../lib/redis');

/**
 * 🪞 Shadow Mirror Middleware (Big Tech Level 9)
 * Duplicates incoming requests and mirrors them to a secondary 'Green' instance
 * for performance and integrity analysis without affecting the 'Blue' response.
 */
const shadowMirrorMiddleware = async (req, res, next) => {
  // Only mirror if configured in Redis (Canary control)
  const mirrorUrl = await redis.get('traffic:shadow:target');
  if (!mirrorUrl) return next();

  // Non-blocking mirror operation
  setImmediate(() => {
    try {
      const targetUrl = new URL(mirrorUrl);
      const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || 80,
        path: req.originalUrl,
        method: req.method,
        headers: {
          ...req.headers,
          'x-is-shadow': 'true', // Flag for the target to avoid side-effects (e.g. no DB writes)
          'host': targetUrl.host
        }
      };

      const mirrorReq = http.request(options);
      
      // Pipe data if exists
      if (req.body && Object.keys(req.body).length > 0) {
        mirrorReq.write(JSON.stringify(req.body));
      }

      mirrorReq.on('error', (err) => {
        logger.debug(`[ShadowMirror] Mirroring failed: ${err.message}`);
      });

      mirrorReq.end();
    } catch (err) {
      // Fail silently for shadow traffic
    }
  });

  next();
};

module.exports = { shadowMirrorMiddleware };
