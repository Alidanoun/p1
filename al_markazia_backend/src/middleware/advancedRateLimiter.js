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
  max: 15, // 15 محاولات فقط
  message: {
    success: false,
    error: 'كثرة محاولات تجديد الجلسة، يرجى الانتظار',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, ip: false }, // Suppress IPv6 warnings if behind proxy
  keyGenerator: (req) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const ua = req.headers['user-agent'] || 'unknown';
    return `${ip}:${ua.substring(0, 50)}`;
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
  validate: { ip: false },
  keyGenerator: (req) => {
    const email = req.body.email || 'unknown';
    const ip = req.ip || 'unknown';
    return `${ip}:${email}`;
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
  windowMs: 60 * 60 * 1000, // ساعة واحدة
  max: 5, // 5 محاولات فقط
  validate: { ip: false },
  keyGenerator: (req) => {
    return req.body.email || req.ip || 'unknown';
  },
  handler: (req, res) => {
    logger.security('OTP_RATE_LIMIT_EXCEEDED', {
      email: req.body.email,
      ip: req.ip
    });
    
    res.status(429).json({
      success: false,
      error: 'كثرة طلبات رمز التحقق، يرجى الانتظار ساعة',
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
  validate: { ip: false },
  keyGenerator: (req) => {
    if (req.user && req.user.id) {
      return `user:${req.user.id}`;
    }
    return `ip:${req.ip}`;
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
  validate: { ip: false },
  keyGenerator: (req) => {
    return req.user?.id || req.ip || 'unknown';
  }
});

module.exports = {
  refreshTokenLimiter,
  loginLimiter,
  otpLimiter,
  apiLimiter,
  uploadLimiter
};
