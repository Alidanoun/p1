const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');
const logger = require('../utils/logger');

// Global storage for the request context
const traceContext = new AsyncLocalStorage();

/**
 * Middleware to generate a unique Request ID for every incoming request.
 * The ID is stored in AsyncLocalStorage so it's accessible deep in the service layer.
 */
const tracingMiddleware = (req, res, next) => {
  // Use existing ID from headers (e.g. from a proxy) or generate a new one
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  
  // Set the trace ID in the response header for client-side visibility
  res.setHeader('x-request-id', requestId);
  
  // Log the entry point
  logger.info(`> [ReqStart] ${req.method} ${req.url}`, { requestId });

  const startTime = Date.now();

  // Handle cleanup and logging on response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info(`< [ReqEnd] ${req.method} ${req.url} | ${res.statusCode} | ${duration}ms`, { 
      requestId, 
      statusCode: res.statusCode, 
      duration 
    });
  });

  // Run the rest of the request within the context
  traceContext.run({ requestId }, () => {
    next();
  });
};

/**
 * Helper to retrieve the current request ID from anywhere in the call stack.
 */
const getRequestId = () => {
  const context = traceContext.getStore();
  return context ? context.requestId : null;
};

module.exports = {
  tracingMiddleware,
  getRequestId
};
