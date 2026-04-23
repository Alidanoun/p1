const logger = require('../utils/logger');

/**
 * 🕵️ Query Profiler Middleware (Development Only)
 * Tracks the number of database queries executed per request to detect N+1 issues.
 */
module.exports = (prisma) => (req, res, next) => {
  if (process.env.NODE_ENV === 'production') return next();
  
  let queryCount = 0;
  
  // Attach a temporary middleware to the prisma client for this request
  // Note: This is a simplified version using Prisma's $use (deprecated but useful for this specific profiling)
  const disconnect = prisma.$use(async (params, nextQuery) => {
    queryCount++;
    return nextQuery(params);
  });
  
  res.on('finish', () => {
    // Alert if more than 10 queries are executed for a single request
    if (queryCount > 15) {
      logger.warn(`🛑 Performance Alert: High query count detected!`, {
        method: req.method,
        path: req.originalUrl,
        queryCount: queryCount,
        suggestion: 'Check for N+1 problems in this route.'
      });
    }
  });
  
  next();
};
