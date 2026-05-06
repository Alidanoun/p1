const logger = require('../utils/logger');

/**
 * 📊 Performance Monitoring Middleware
 * Tracks request duration and identifies slow endpoints.
 */
function performanceMonitor(req, res, next) {
  const start = process.hrtime();
  const url = req.originalUrl || req.url;

  // Wait for the response to finish
  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);
    const status = res.statusCode;

    // Log performance metrics
    const logData = {
      method: req.method,
      url,
      status,
      duration: `${durationMs}ms`,
      ip: req.ip,
      instanceId: process.env.INSTANCE_ID
    };

    // Warn if request is slow (> 1000ms)
    if (durationMs > 1000) {
      logger.warn(`⚠️ [SLOW_REQUEST] ${req.method} ${url} took ${durationMs}ms`, logData);
    } else if (process.env.DEBUG_PERFORMANCE === 'true') {
      logger.debug(`[PERF] ${req.method} ${url} - ${durationMs}ms`, logData);
    }
  });

  next();
}

module.exports = performanceMonitor;
