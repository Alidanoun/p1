const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default; // Important: .default for newer versions
const redis = require('../lib/redis');
const logger = require('../utils/logger');

/**
 * 🚦 Advanced Rate Limiter
 * يستخدم Redis للتخزين الموزع
 */

// 1. Refresh Token Rate Limiter
const refreshTokenLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: 'rl:refresh:',
  }),
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 100, // تم الرفع من 15 إلى 100 لتفادي مشاكل الـ Refresh المتكرر في التطوير
  message: {
    success: false,
    error: 'كثرة محاولات تجديد الجلسة، يرجى الانتظار',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false, // 🛡️ Fix for ERR_ERL_KEY_GEN_IPV6
  keyGenerator: (req) => {
    return `refresh:${req.ip}`;
  },
  handler: (req, res) => {
    logger.security('RATE_LIMIT_EXCEEDED', {
      endpoint: '/auth/refresh',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    res.status(429).json({
      success: false,
      error: 'كثرة محاولات تجديد الجلسة، يرجى الانتظار 15 دقيقة',
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }
});

// 2. Login Rate Limiter
const loginLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: 'rl:login:',
  }),
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 10, // 10 محاولات فقط
  skipSuccessfulRequests: true,
  validate: false,
  keyGenerator: (req) => {
    const email = req.body.email || 'unknown';
    return `login:${req.ip}:${email}`;
  },
  handler: (req, res) => {
    logger.security('LOGIN_RATE_LIMIT_EXCEEDED', {
      email: req.body.email,
      ip: req.ip
    });
    
    res.status(429).json({
      success: false,
      error: 'كثرة محاولات تسجيل الدخول، يرجى الانتظار 15 دقيقة',
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }
});

// 3. OTP Rate Limiter
const otpLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: 'rl:otp:',
  }),
  windowMs: 10 * 60 * 1000, // 10 دقائق
  max: 5, // 5 محاولات فقط
  validate: false,
  keyGenerator: (req) => {
    const email = req.body.email || 'unknown';
    return `otp:${email}:${req.ip}`;
  },
  handler: (req, res) => {
    logger.security('OTP_RATE_LIMIT_EXCEEDED', {
      email: req.body.email,
      ip: req.ip
    });
    
    res.status(429).json({
      success: false,
      error: 'كثرة طلبات رمز التحقق، يرجى الانتظار 10 دقائق',
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }
});

// 4. API General Rate Limiter
const apiLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: 'rl:api:',
  }),
  windowMs: 1 * 60 * 1000, // دقيقة واحدة
  max: 200, // 200 طلب في الدقيقة
  validate: false,
  keyGenerator: (req) => {
    const identifier = req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
    return `api:${identifier}`;
  },
  skip: (req) => {
    // 🧪 Allow localhost to bypass rate limiting for load testing
    return req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  },
  handler: (req, res) => {
    logger.warn('API_RATE_LIMIT_EXCEEDED', {
      userId: req.user?.id,
      ip: req.ip,
      endpoint: req.originalUrl
    });
    
    res.status(429).json({
      success: false,
      error: 'كثرة الطلبات، يرجى الانتظار قليلاً',
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }
});

// 5. Upload Rate Limiter
const uploadLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: 'rl:upload:',
  }),
  windowMs: 60 * 60 * 1000, // ساعة واحدة
  max: 30, // 30 تحميل في الساعة
  validate: false,
  keyGenerator: (req) => {
    const identifier = req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
    return `upload:${identifier}`;
  }
});

module.exports = {
  refreshTokenLimiter,
  loginLimiter,
  otpLimiter,
  apiLimiter,
  uploadLimiter
};
