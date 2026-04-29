const workingHoursService = require('../services/workingHoursService');
const logger = require('../utils/logger');

/**
 * 🚧 WorkingHoursGuard Middleware
 * Ensures the restaurant is open before allowing sensitive actions (like placing an order).
 */
const workingHoursGuard = async (req, res, next) => {
  try {
    const status = await workingHoursService.getStatus();

    if (!status.isOpen) {
      logger.warn('[WorkingHoursGuard] Order REJECTED - Restaurant is closed', {
        userId: req.user?.id || 'guest',
        reason: status.reason,
        isEmergency: status.isEmergency
      });

      return res.status(403).json({
        success: false,
        error: 'RESTAURANT_CLOSED',
        message: status.reason,
        nextOpenAt: status.nextOpenAt
      });
    }

    next();
  } catch (error) {
    logger.error('[WorkingHoursGuard] Error in middleware', { error: error.message });
    // In case of error, we default to OPEN to avoid blocking sales unless it's a critical DB failure
    next();
  }
};

module.exports = workingHoursGuard;
