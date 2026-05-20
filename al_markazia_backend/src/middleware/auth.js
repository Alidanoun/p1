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
  const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.accessToken;

  if (!token) {
    logger.security('Access denied: No token provided', { ip: req.ip, endpoint: req.originalUrl });
    return responseError(res, 'يجب تسجيل الدخول للوصول لهذه الخدمة', 'UNAUTHORIZED', 401);
  }

  // 🛡️ Token Binding: Double-layer CSRF validation for cookie-based state-changing operations
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method?.toUpperCase());
  if (isStateChanging && req.cookies?.accessToken && !authHeader) {
    const xsrfHeader = req.headers['x-xsrf-token'];
    const xsrfCookie = req.cookies['XSRF-TOKEN'];
    if (!xsrfHeader || !xsrfCookie || xsrfHeader !== xsrfCookie) {
      logger.security('[CSRF_BLOCKED] Missing or mismatched X-XSRF-TOKEN header during cookie-authenticated operation', { ip: req.ip, endpoint: req.originalUrl });
      return responseError(res, 'فشل التحقق الأمني من مصدر الطلب (CSRF)', 'SECURITY_BREACH', 403);
    }
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
    
    // Safely extract the fingerprint hash supporting raw string, JSON-stringified object, or parsed object formats
    let sessionFingerprintHash = null;
    if (session.fingerprint) {
      if (typeof session.fingerprint === 'string') {
        if (session.fingerprint.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(session.fingerprint);
            sessionFingerprintHash = parsed.hash || parsed;
          } catch (e) {
            sessionFingerprintHash = session.fingerprint;
          }
        } else {
          sessionFingerprintHash = session.fingerprint;
        }
      } else if (typeof session.fingerprint === 'object') {
        sessionFingerprintHash = session.fingerprint.hash || session.fingerprint;
      }
    }

    // Permit biometric hardware trusted sessions to bypass strict sec-ch-ua browser string matching
    const isBiometricTrust = sessionFingerprintHash === 'biometric-hardware-trusted';
    if (!isBiometricTrust && sessionFingerprintHash && sessionFingerprintHash !== currentFingerprint.hash) {
      logger.security('[SESSION_HIJACKING_DETECTED] Identity mismatch', { 
        userId: decoded.id, 
        ip: req.ip,
        sessionFingerprint: sessionFingerprintHash,
        currentFingerprint: currentFingerprint.hash
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

    // 5. 🛡️ JWT Blacklist Check (Instant Revocation Guard)
    const { checkTokenNotBlacklisted } = require('./tokenBlacklistCheck');
    let isBlacklistedResult = false;
    await checkTokenNotBlacklisted(req, res, (err) => {
      if (err) {
        logger.error('Error in checkTokenNotBlacklisted', { error: err.message });
      }
      isBlacklistedResult = true;
    });
    if (!isBlacklistedResult || res.headersSent) return;

    // 🛡️ Resolve and unify Requested Branch Context (Query > Body > Header)
    const contextBranch = req.query?.branchId || req.body?.branchId || req.headers['x-branch-context'];
    if (contextBranch && contextBranch !== 'null' && contextBranch !== 'undefined' && contextBranch !== '') {
      req.user.requestedBranchId = contextBranch;
    }

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
 * 🛡️ Optional Authentication (Refined v3)
 * Tries to authenticate the user but proceeds as guest if no token is present, invalid, or expired.
 */
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.accessToken;
  if (!token) {
    req.user = null;
    const { runInContext } = require('../utils/securityContext');
    return runInContext(null, () => next());
  }

  try {
    // 1. 🛡️ JWT Standard Verification
    const decoded = TokenService.verifyAccessToken(token);
    if (!decoded) throw new Error('INVALID_TOKEN');

    // 2. 🛡️ Session & Version Validation
    const validation = await TokenService.validateSessionState(decoded);
    if (!validation.valid) throw new Error(validation.reason);

    // 3. 🛡️ Device Binding Check
    const currentFingerprint = generateFingerprint(req);
    const session = validation.session || {};
    
    let sessionFingerprintHash = null;
    if (session.fingerprint) {
      if (typeof session.fingerprint === 'string') {
        if (session.fingerprint.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(session.fingerprint);
            sessionFingerprintHash = parsed.hash || parsed;
          } catch (e) {
            sessionFingerprintHash = session.fingerprint;
          }
        } else {
          sessionFingerprintHash = session.fingerprint;
        }
      } else if (typeof session.fingerprint === 'object') {
        sessionFingerprintHash = session.fingerprint.hash || session.fingerprint;
      }
    }

    const isBiometricTrust = sessionFingerprintHash === 'biometric-hardware-trusted';
    if (!isBiometricTrust && sessionFingerprintHash && sessionFingerprintHash !== currentFingerprint.hash) {
      throw new Error('SESSION_HIJACKED');
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

    // 🛡️ Resolve and unify Requested Branch Context (Query > Body > Header)
    const contextBranch = req.query?.branchId || req.body?.branchId || req.headers['x-branch-context'];
    if (contextBranch && contextBranch !== 'null' && contextBranch !== 'undefined' && contextBranch !== '') {
      req.user.requestedBranchId = contextBranch;
    }

    const { runInContext } = require('../utils/securityContext');
    return runInContext(req.user, () => next());

  } catch (error) {
    logger.debug(`[OptionalAuth] Invalid or expired token: ${error.message}. Treating user as Guest.`, { ip: req.ip });
    req.user = null;
    res.set('X-Session-Status', 'expired');
    const { runInContext } = require('../utils/securityContext');
    return runInContext(null, () => next());
  }
};

module.exports = { 
  authenticateToken, 
  optionalAuth,
  isAdmin, 
  isManager,
  hasPermission,
  requireRoles
};
