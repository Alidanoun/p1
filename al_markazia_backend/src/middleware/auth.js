const logger = require('../utils/logger');
const TokenService = require('../services/tokenService');
const { error: responseError } = require('../utils/response');

const redis = require('../lib/redis');

/**
 * Enterprise Authentication Middleware
 * Validates JWT tokens and populates req.user with UUID context.
 * Standardizes security for both Admins and Customers.
 */
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    logger.security('Access denied: No token provided', { 
      ip: req.ip, 
      endpoint: req.originalUrl 
    });
    return responseError(res, 'يجب تسجيل الدخول للوصول لهذه الخدمة', 'UNAUTHORIZED', 401);
  }

  try {
    const decoded = TokenService.verifyAccessToken(token);
    const { id: userId, jti } = decoded;

    // 🛡️ JTI Revocation Check (Foundation Step)
    if (jti) {
      const sessionExists = await redis.exists(`session:${userId}:${jti}`);
      if (!sessionExists) {
        logger.security('REVOKED_SESSION_ACCESS_ATTEMPT', { userId, jti, ip: req.ip });
        return responseError(res, 'انتهت صلاحية الجلسة أو تم إلغاؤها', 'SESSION_REVOKED', 401);
      }
    }
    
    // Populate request with User Context
    req.user = {
      id: userId, // This is the UUID
      phone: decoded.phone,
      role: (decoded.role || '').toLowerCase(), // 🧠 Identity Normalization
      jti: jti
    };
    
    next();
  } catch (error) {
    const isExpired = error.message === 'TOKEN_EXPIRED';
    const errorCode = isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    const message = isExpired ? 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول' : 'رمز الدخول غير صالح';

    logger.security(`Failed JWT validation: ${error.message}`, { 
      ip: req.ip, 
      endpoint: req.originalUrl 
    });

    // 🚀 Critical Fix: 401 for Expired Tokens triggers client-side refresh logic
    return responseError(res, message, errorCode, 401);
  }
};

/**
 * 👑 Role Hierarchy Definition
 */
const ROLE_LEVELS = {
  'super_admin': 3,
  'admin': 2,
  'manager': 2,
  'staff': 1,
  'customer': 0
};

/**
 * Role-Based Access Control (RBAC) Helper
 * Supports both explicit role lists and minimum level requirements.
 */
const requireRoles = (allowedRolesOrMinRole) => (req, res, next) => {
  if (!req.user) {
    return responseError(res, 'يجب تسجيل الدخول أولاً', 'UNAUTHORIZED', 401);
  }

  const userRole = req.user.role;
  let isAuthorized = false;

  if (Array.isArray(allowedRolesOrMinRole)) {
    // Check if user has one of the specific roles
    isAuthorized = allowedRolesOrMinRole.includes(userRole);
  } else if (typeof allowedRolesOrMinRole === 'string') {
    // Check if user meets minimum role level
    const userLevel = ROLE_LEVELS[userRole] || 0;
    const requiredLevel = ROLE_LEVELS[allowedRolesOrMinRole] || 0;
    isAuthorized = userLevel >= requiredLevel;
  }

  if (isAuthorized) {
    return next();
  }
  
  logger.security('FORBIDDEN_ACCESS attempt', { 
    ip: req.ip, 
    endpoint: req.originalUrl,
    userId: req.user?.id,
    userRole: userRole,
    requiredRoles: allowedRolesOrMinRole
  });

  return responseError(res, 'غير مصرح لك بالوصول لهذه المنطقة', 'FORBIDDEN_ACCESS', 403);
};

const isAdmin = requireRoles('admin');
const isSuperAdmin = requireRoles('super_admin');
const isStaff = requireRoles('staff');

/**
 * 🟡 Optional Authentication Middleware
 * Allows guests (no token) while validating existing tokens.
 */
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // 1. Guest Case: No token provided at all
  if (!token) {
    req.user = null;
    return next();
  }

  // 2. Token Provided: MUST be valid
  try {
    const decoded = TokenService.verifyAccessToken(token);
    const { id: userId, jti } = decoded;

    // 🛡️ JTI Revocation Check
    if (jti) {
      const sessionExists = await redis.exists(`session:${userId}:${jti}`);
      if (!sessionExists) {
        req.user = null; // Treat as guest if session revoked
        return next();
      }
    }

    req.user = {
      id: userId,
      phone: decoded.phone,
      role: (decoded.role || '').toLowerCase(),
      jti: jti
    };
    next();
  } catch (error) {
    const isExpired = error.message === 'TOKEN_EXPIRED';
    const errorCode = isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    const message = isExpired ? 'الجلسة منتهية، يرجى تسجيل الدخول مجدداً' : 'رمز الدخول غير صالح';

    logger.security(`Optional Auth Failed: ${error.message}`, {
      ip: req.ip,
      endpoint: req.originalUrl
    });

    return responseError(res, message, errorCode, 401);
  }
};

module.exports = { 
  authenticateToken, 
  isAdmin, 
  isSuperAdmin,
  isStaff,
  requireRoles,
  optionalAuth
};
