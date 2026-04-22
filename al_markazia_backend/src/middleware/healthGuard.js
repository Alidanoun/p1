const circuitBreaker = require('../services/circuitBreakerService');
const observability = require('../services/observabilityService');
const logger = require('../utils/logger');

/**
 * 🛡️ Health Guard Middleware
 * High-level gatekeeper that blocks requests if a critical service 
 * circuit is OPEN or the system score is dangerously low.
 * 
 * Usage: router.post('/create', healthGuard('db'), orderController.createOrder);
 */
const healthGuard = (requiredService = null) => {
  return async (req, res, next) => {
    // 1. Check Specific Circuit
    if (requiredService) {
      const isOpen = await circuitBreaker.isOpen(requiredService);
      if (isOpen) {
        logger.warn(`[HealthGuard] ⚔️ Blocking request: Circuit is OPEN for ${requiredService}`, { 
          endpoint: req.originalUrl,
          requestId: req.requestId 
        });
        return res.status(503).json({
          error: 'الخدمة غير متوفرة مؤقتاً',
          message: 'نواجه مشاكل تقنية مع أحد أنظمتنا، المصروفات محمية وسيتم إصلاح الخلل آلياً خلال دقائق.',
          service: requiredService,
          retryAfter: 30
        });
      }
    }

    // 2. Check Global Score (Total System Isolation)
    const health = await observability.getLiveStatus();
    if (health.status === 'CRITICAL' && (requiredService === 'db' || requiredService === 'redis')) {
      return res.status(503).json({
        error: 'النظام في حالة صيانة طارئة',
        message: 'نعتذر، النظام يخضع لعملية تعافي تلقائي بسبب خلل تقني حرج.'
      });
    }

    next();
  };
};

module.exports = { healthGuard };
