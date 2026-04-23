const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// التقييد العام للنظام (Global Limiter)
// 120 طلب لكل رقم IP في الدقيقة الواحدة
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 300, 
  standardHeaders: true, 
  legacyHeaders: false, 
  message: { success: false, message: 'Too many requests' },
  handler: (req, res, next, options) => {
    logger.warn(`Global Rate Limit Exceeded: IP ${req.ip} | Route ${req.originalUrl}`);
    res.status(options.statusCode).json(options.message);
  }
});

// تقييد المصادقة (Auth Limiter)
// حماية طلبات تسجيل الدخول والتوثيق لمنع Brute Force
// 30 طلب لكل رقم IP في الدقيقة الواحدة
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts. Please try again later.' },
  handler: (req, res, next, options) => {
    logger.warn(`Auth Rate Limit Exceeded: IP ${req.ip} | Route ${req.originalUrl}`);
    res.status(options.statusCode).json(options.message);
  }
});

// تقييد إنشاء الطلبات (Order Creation Limiter)
// 40 مسودة أو طلب لكل رقم IP في الدقيقة الواحدة لمنع الـ Spam
const orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many orders placed in a short period. Please slow down.' },
  handler: (req, res, next, options) => {
    logger.warn(`Order Rate Limit Exceeded: IP ${req.ip}`);
    res.status(options.statusCode).json(options.message);
  }
});

// تقييد البحث (Search Limiter)
// 50 طلب بحث لكل رقم IP في الدقيقة الواحدة لمنع الـ Scraping والـ Spam
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many search requests. Please slow down.' },
  handler: (req, res, next, options) => {
    logger.warn(`Search Rate Limit Exceeded: IP ${req.ip}`);
    res.status(options.statusCode).json(options.message);
  }
});

module.exports = {
  globalLimiter,
  authLimiter,
  orderLimiter,
  searchLimiter
};
