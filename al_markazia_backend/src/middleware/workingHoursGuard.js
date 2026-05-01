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
    logger.error('[WORKING_HOURS_GUARD_FAIL_CLOSE] Critical error in middleware. Blocking request.', { error: error.message });
    
    // 🛡️ Fail-Close: If status is uncertain, we MUST block.
    return res.status(403).json({
      success: false,
      error: 'RESTAURANT_STATUS_UNCERTAIN',
      message: 'عذراً، لا يمكن معالجة طلبك حالياً بسبب عطل فني في التحقق من أوقات العمل. يرجى المحاولة لاحقاً.'
    });
  }
};

module.exports = workingHoursGuard;
