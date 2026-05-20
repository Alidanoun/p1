const governor = require('../services/governorService');
const arbitrator = require('../services/arbitratorService');
const logger = require('../utils/logger');

/**
 * 🚦 Governor Middleware
 * Category-based protection for routes.
 * Enforces system-wide load limits per priority category.
 */
const governorGuard = (priorityName = 'MISSION_CRITICAL') => {
  return async (req, res, next) => {
    try {
      const isAllowed = await governor.checkLimit(priorityName);
      if (!isAllowed) {
        logger.warn(`[Governor] Request rejected: ${priorityName} limit exceeded`, {
          ip: req.ip,
          path: req.path,
          priority: priorityName
        });
        return res.status(503).json({
          success: false,
          error: 'SYSTEM_OVERLOADED',
          message: 'النظام تحت ضغط عالٍ، يرجى المحاولة لاحقاً',
          code: 'GOVERNOR_REJECTED',
          priority: priorityName
        });
      }
      next();
    } catch (err) {
      // Fail-open for governor — don't block requests if governor service fails
      logger.error('[Governor] Check failed, allowing request', { error: err.message });
      next();
    }
  };
};

module.exports = { governorGuard };
