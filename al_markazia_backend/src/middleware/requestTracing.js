const crypto = require('crypto');
const { traceContext } = require('../utils/context');

/**
 * Enterprise Request Tracing Middleware
 * Generates/extracts a unique requestId and stores it in AsyncLocalStorage
 * so it's accessible across the entire call stack without manual passing.
 */
const requestTracing = (req, res, next) => {
  // 🛡️ Resolve Circular Dependency: Import logger inside the function
  const logger = require('../utils/logger');

  // Use existing ID or generate a new UUID
  const requestId = req.headers['x-request-id'] || req.query.requestId || crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);

  const startTime = Date.now();
  
  // ⚡ Jittered Sampling Strategy (15% - 25% dynamic range for regular logs)
  const samplingRate = 0.15 + (Math.random() * 0.1);
  const isSampled = Math.random() < samplingRate;
  req.isSampled = isSampled;
  req.requestId = requestId; // Attach to req for easy access

  // 🥇 Trace Lifecycle - Entry
  if (isSampled) {
    logger.info(`> [ReqStart] ${req.method} ${req.url}`, { requestId });
  }

  // 🥈 Trace Lifecycle - Exit (Calculates Response Time)
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info(`< [ReqEnd] ${req.method} ${req.url} | ${res.statusCode} | ${duration}ms`, { 
      requestId, 
      statusCode: res.statusCode, 
      duration: `${duration}ms`
    });
  });

  // Run downstream logic within the storage context
  traceContext.run({ requestId }, () => {
    next();
  });
};

module.exports = {
  requestTracing
};
