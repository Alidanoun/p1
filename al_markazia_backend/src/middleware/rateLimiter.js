const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// التقييد العام للنظام (Global Limiter)
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 300, 
  validate: false,
  standardHeaders: true, 
  legacyHeaders: false, 
  message: { success: false, message: 'Too many requests' },
  handler: (req, res, next, options) => {
    logger.warn(`Global Rate Limit Exceeded: IP ${req.ip} | Route ${req.originalUrl}`);
    res.status(options.statusCode).json(options.message);
  }
});

// تقييد المصادقة (Auth Limiter)
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.body?.email || req.body?.phone || req.ip,
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts. Please try again later.' },
  handler: (req, res, next, options) => {
    logger.warn(`Auth Rate Limit Exceeded: IP ${req.ip} | Route ${req.originalUrl}`);
    res.status(options.statusCode).json(options.message);
  }
});

// تقييد إنشاء الطلبات (Order Creation Limiter)
const orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  keyGenerator: (req) => req.user?.id || req.ip,
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many orders placed in a short period. Please slow down.' },
  handler: (req, res, next, options) => {
    logger.warn(`Order Rate Limit Exceeded: IP ${req.ip}`);
    res.status(options.statusCode).json(options.message);
  }
});

// تقييد البحث (Search Limiter)
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  keyGenerator: (req) => req.user?.id || req.ip,
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many search requests. Please slow down.' },
  handler: (req, res, next, options) => {
    logger.warn(`Search Rate Limit Exceeded: IP ${req.ip}`);
    res.status(options.statusCode).json(options.message);
  }
});

// تقييد التقييمات (Review Limiter)
const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user?.id || req.ip,
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: { 
    error: 'لقد تجاوزت الحد المسموح من التقييمات، حاول لاحقاً', 
    code: 'REVIEW_RATE_LIMIT' 
  },
  handler: (req, res, next, options) => {
    logger.warn(`Review Rate Limit Exceeded: User ${req.user?.id || req.ip}`);
    res.status(options.statusCode).json(options.message);
  }
});

// تقييد الإبلاغ (Flag Limiter)
const flagLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.id || req.ip,
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many flag requests' }
});

module.exports = {
  globalLimiter,
  authLimiter,
  orderLimiter,
  searchLimiter,
  reviewLimiter,
  flagLimiter
};
