const governor = require('../services/governorService');
const arbitrator = require('../services/arbitratorService');
const { DEGRADATION_MODES } = require('../services/arbitratorService');
const logger = require('../utils/logger');

/**
 * 🚦 Governor Middleware
 * Category-based protection for routes.
 */
const governorGuard = (priorityName = 'MISSION_CRITICAL') => {
  return async (req, res, next) => {
    const priority = governor.PRIORITIES[priorityName] || 1;
    const mode = await arbitrator.getCurrentMode();

    // 1. Emergency Mode (Full Shutdown for safety)
    if (mode === DEGRADATION_MODES.EMERGENCY) {
      return res.status(503).json({
        error: 'النظام في وضع الصيانة الطارئة',
        message: 'نعتذر، تم إيقاف النظام مؤقتاً لحماية البيانات والعمليات. يرجى المحاولة لاحقاً.'
      });
    }

    // 2. Read-Only Mode (Protecting core database records)
    if (mode === DEGRADATION_MODES.READ_ONLY && req.method !== 'GET') {
      return res.status(503).json({
        error: 'وضع حماية البيانات نشط',
        message: 'نعتذر، النظام حالياً في وضع "القراءة فقط" لضمان استقرار السجلات. العمليات الشرائية معطلة مؤقتاً.'
      });
    }

    // Track metrics globally
    await governor.trackRequest();

    const shouldShed = await governor.shouldShed(priority);
    
    if (shouldShed) {
      logger.warn(`[Governor] 🚦 Load Shedding: Dropping request`, { priority: priorityName, mode });
      return res.status(429).json({
        error: 'النظام تحت ضغط عالٍ',
        message: 'نعتذر، تم تعليق بعض الخدمات غير الأساسية مؤقتاً لضمان استقرار العمليات الأساسية.'
      });
    }

    next();
  };
};

module.exports = { governorGuard };
