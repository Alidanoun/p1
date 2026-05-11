const logger = require('../utils/logger');
const TokenService = require('../services/tokenService');
const { error: responseError } = require('../utils/response');
const { generateFingerprint } = require('../utils/security');
const redis = require('../lib/redis');

/**
 * 🏰 Enterprise Authentication Middleware (Hardened v3)
 * Implements real-time version validation with Authority Fallback.
 */
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    logger.security('Access denied: No token provided', { ip: req.ip, endpoint: req.originalUrl });
    return responseError(res, 'يجب تسجيل الدخول للوصول لهذه الخدمة', 'UNAUTHORIZED', 401);
  }

  try {
    // 1. 🛡️ JWT Standard Verification
    const decoded = TokenService.verifyAccessToken(token);
    if (!decoded) throw new Error('INVALID_TOKEN');

    // 2. 🛡️ [PHASE 3] Session & Version Validation (The Security Fortress)
    // Checks Redis (Fast) or DB (Authority Fallback) for authVersion/permissionVersion
    const validation = await TokenService.validateSessionState(decoded);

    if (!validation.valid) {
      const { reason } = validation;
      logger.security('SESSION_INVALIDATED', { userId: decoded.id, reason, ip: req.ip });
      
      const messages = {
        'VERSION_DRIFT': 'تم تحديث صلاحياتك، يرجى تسجيل الدخول مجدداً لتفعيل التغييرات',
        'STATE_INVALIDATED': 'انتهت صلاحية الجلسة الأمنية، يرجى إعادة تسجيل الدخول',
        'USER_INACTIVE': 'تم إيقاف حسابك، يرجى التواصل مع الإدارة'
      };

      return responseError(res, messages[reason] || 'الجلسة غير صالحة', reason, 401);
    }

    // 3. 🛡️ Device Binding Check (Optional but Recommended)
    const currentFingerprint = generateFingerprint(req);
    const session = validation.session || {}; // Only available if Redis hit
    
    if (session.fingerprint && session.fingerprint !== currentFingerprint.hash) {
      logger.security('[SESSION_HIJACKING_DETECTED] Identity mismatch', { 
        userId: decoded.id, 
        ip: req.ip 
      });
      return responseError(res, 'تنبيه أمني: محاولة وصول من جهاز غير معروف', 'SECURITY_BREACH', 401);
    }

    // 4. 🏢 Populate Request Context
    req.user = {
      id: decoded.id,
      role: (session.role || decoded.role || '').toLowerCase(),
      branchId: session.branchId || decoded.branchId || null,
      jti: decoded.sid,
      av: decoded.av,
      pv: decoded.pv
    };

    const { runInContext } = require('../utils/securityContext');
    runInContext(req.user, () => next());

  } catch (error) {
    const isExpired = error.message === 'TOKEN_EXPIRED';
    logger.security(`Failed JWT validation: ${error.message}`, { ip: req.ip, error: error.message });
    return responseError(res, isExpired ? 'انتهت الجلسة' : 'رمز الدخول غير صالح', isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN', 401);
  }
};

const { ROLE_PERMISSIONS } = require('../config/permissions');

const ROLE_LEVELS = {
  'admin': 5,
  'branch_manager': 2,
  'manager': 2,
  'staff': 1,
  'customer': 0
};

const hasPermission = (permission) => async (req, res, next) => {
  if (!req.user) return responseError(res, 'يجب تسجيل الدخول أولاً', 'UNAUTHORIZED', 401);

  const permissions = ROLE_PERMISSIONS[req.user.role] || [];
  if (permissions.includes(permission)) return next();

  logger.security('PERMISSION_DENIED', { userId: req.user.id, role: req.user.role, required: permission });
  return responseError(res, 'غير مصرح لك بالقيام بهذا الإجراء', 'PERMISSION_DENIED', 403);
};

const requireRoles = (allowedRolesOrMinRole) => (req, res, next) => {
  if (!req.user) return responseError(res, 'يجب تسجيل الدخول أولاً', 'UNAUTHORIZED', 401);

  let isAuthorized = false;
  if (Array.isArray(allowedRolesOrMinRole)) {
    isAuthorized = allowedRolesOrMinRole.includes(req.user.role);
  } else {
    isAuthorized = (ROLE_LEVELS[req.user.role] || 0) >= (ROLE_LEVELS[allowedRolesOrMinRole] || 0);
  }

  if (isAuthorized) return next();
  return responseError(res, 'غير مصرح لك بالوصول لهذه المنطقة', 'FORBIDDEN_ACCESS', 403);
};

const isAdmin = requireRoles(['admin']);
const isManager = requireRoles(['admin', 'branch_manager', 'manager']);

/**
 * 🛡️ Optional Authentication
 * Tries to authenticate the user but proceeds as guest if no token is present.
 */
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return next(); // Proceed as guest
  return authenticateToken(req, res, next);
};

module.exports = { 
  authenticateToken, 
  optionalAuth,
  isAdmin, 
  isManager,
  hasPermission,
  requireRoles
};
