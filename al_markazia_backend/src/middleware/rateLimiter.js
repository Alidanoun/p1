const { createLimiter } = require('./advancedRateLimiter');

// 🌐 التقييد العام للنظام (Global Limiter)
const globalLimiter = createLimiter({
  scope: 'global',
  windowMs: 60 * 1000,
  maxRequests: 300,
  errorMessage: 'Too many requests'
});

// 🔐 تقييد المصادقة (Auth Limiter) - Hardened: 5 attempts per 15 mins
const authLimiter = createLimiter({
  scope: 'auth',
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  errorMessage: 'تجاوزت الحد المسموح من المحاولات. يرجى المحاولة بعد 15 دقيقة.',
  keyBuilder: (req) => `${req.ip}_${req.body?.email || req.body?.phone || 'guest'}`
});

// 📦 تقييد إنشاء الطلبات (Order Creation Limiter) - يدعم الاستدعاء المباشر والهرمي
const baseOrderLimiter = createLimiter({
  scope: 'orders',
  windowMs: 60 * 1000,
  maxRequests: 3,
  errorMessage: 'Too many orders placed in a short period. Please slow down.'
});

const orderLimiter = async (req, res, next) => {
  return baseOrderLimiter(req, res, next);
};

// ✅ إضافة المستويات الهرمية كخصائص لدعم الحماية المتعددة (Hierarchical Limiting)
orderLimiter.perUser = createLimiter({
  scope: 'orders',
  windowMs: 60 * 1000,
  maxRequests: 10,
  keyBuilder: (req) => `user:${req.user?.id || req.ip}`
});

orderLimiter.perBranch = createLimiter({
  scope: 'orders',
  windowMs: 60 * 1000,
  maxRequests: 100,
  keyBuilder: (req) => `branch:${req.headers?.['x-branch-id'] || 'default'}`
});

orderLimiter.global = createLimiter({
  scope: 'orders',
  windowMs: 60 * 1000,
  maxRequests: 1000
});

// 🛡️ منع بات لإنشاء الطلبات من قبل الضيوف (Guest Order Creation Guard)
// يسمح للضيوف بالاطلاع فقط على محتوى التطبيق ويمنعهم تماماً من تنفيذ مسارات الحجز/الطلبات
const guestOrderLimiter = async (req, res, next) => {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const logger = require('../utils/logger');
    if (logger && typeof logger.security === 'function') {
      logger.security('[GUEST_ORDERS_FORBIDDEN] Unauthenticated guest attempted order creation restricted', { ip: req.ip, path: req.path });
    }
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED_GUEST',
      message: 'عذراً، لا يمكن للضيوف إنشاء طلبات. يرجى تسجيل الدخول أولاً لإتمام الطلب.',
      code: 'GUEST_ORDERS_FORBIDDEN'
    });
  }
  next();
};

// 🔍 تقييد البحث (Search Limiter)
const searchLimiter = createLimiter({
  scope: 'search',
  windowMs: 60 * 1000,
  maxRequests: 50,
  errorMessage: 'Too many search requests. Please slow down.'
});

// ⭐ تقييد التقييمات (Review Limiter)
const reviewLimiter = createLimiter({
  scope: 'reviews',
  windowMs: 60 * 60 * 1000,
  maxRequests: 5,
  errorMessage: 'لقد تجاوزت الحد المسموح من التقييمات، حاول لاحقاً'
});

// 🚩 تقييد الإبلاغ (Flag Limiter)
const flagLimiter = createLimiter({
  scope: 'global',
  windowMs: 60 * 60 * 1000,
  maxRequests: 20,
  errorMessage: 'Too many flag requests'
});

// 🔑 تقييد استعادة كلمة المرور (Forgot Password Limiter)
const forgotPasswordLimiter = createLimiter({
  scope: 'auth',
  windowMs: 60 * 60 * 1000,
  maxRequests: 5,
  errorMessage: 'تم تجاوز الحد المسموح. حاول بعد ساعة.'
});

module.exports = {
  globalLimiter,
  authLimiter,
  orderLimiter,
  guestOrderLimiter,
  searchLimiter,
  reviewLimiter,
  flagLimiter,
  forgotPasswordLimiter
};
