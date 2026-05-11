const idGenerator = require('../utils/idGenerator');

/**
 * 🔗 Correlation Middleware
 * Ensures every request has a unique identifier for end-to-end tracing.
 */
const correlationMiddleware = (req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || idGenerator.generateTraceId();
  
  // Inject into request object for services to access
  req.correlationId = correlationId;
  
  // Set in response header for client-side tracing
  res.setHeader('X-Correlation-ID', correlationId);
  
  next();
};

module.exports = correlationMiddleware;
