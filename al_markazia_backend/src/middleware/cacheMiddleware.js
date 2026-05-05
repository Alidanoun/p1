const cacheService = require('../services/cacheService');
const logger = require('../utils/logger');

/**
 * 🔄 Auto-Cache GET Requests
 * Middleware to intercept GET requests and serve them from cache if available.
 */
const withCache = (cacheKey, options = {}) => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') return next();

    const id = options.idParam ? req.params[options.idParam] : 'global';
    
    try {
      const cached = await cacheService.get(cacheKey, id);
      if (cached) {
        res.set('X-Cache', 'HIT');
        return res.json(cached);
      }

      res.set('X-Cache', 'MISS');

      // Wrap res.json to capture and cache the response
      const originalJson = res.json.bind(res);
      res.json = (data) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          cacheService.set(cacheKey, id, data).catch(err => 
            logger.error('[CacheMiddleware] Save failed', { error: err.message })
          );
        }
        return originalJson(data);
      };

      next();
    } catch (err) {
      logger.error('[CacheMiddleware] Error', { error: err.message });
      next();
    }
  };
};

/**
 * 🗑️ Invalidate Cache on Success
 * Middleware to trigger cache invalidation after successful mutations (POST, PUT, DELETE).
 */
const invalidateCache = (cacheKey, options = {}) => {
  return async (req, res, next) => {
    const originalSend = res.send.bind(res);

    res.send = function (data) {
      // Only invalidate if the operation was successful
      if (res.statusCode >= 200 && res.statusCode < 400) {
        const id = options.idParam ? req.params[options.idParam] : null;
        
        cacheService.broadcastInvalidation(cacheKey, id).catch(err => 
          logger.error('[CacheInvalidate] Broadcast failed', { error: err.message })
        );
      }
      return originalSend(data);
    };

    next();
  };
};

module.exports = {
  withCache,
  invalidateCache
};
