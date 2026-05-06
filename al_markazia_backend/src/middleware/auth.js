const logger = require('../utils/logger');
const TokenService = require('../services/tokenService');
const { error: responseError } = require('../utils/response');
const { generateFingerprint } = require('../utils/security');

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
    // 🛡️ Token verification (Self-contained in TokenService)
    const decoded = TokenService.verifyAccessToken(token);
    if (!decoded) {
       throw new Error('VERIFY_RETURNED_NULL');
    }
    
    const { id: userId, jti } = decoded;

    // 🛡️ [SEC-FIX] Permission Drift Guard: Fetch LATEST role/branch from Redis
    // This ensures that if a user is demoted, their access is revoked INSTANTLY 
    // even if their JWT still contains the old role.
    const sessionDataRaw = await redis.get(`session:${userId}:${jti}`);
    if (!sessionDataRaw) {
      logger.security('SESSION_STALE_OR_MISSING', { userId, jti, ip: req.ip });
      return responseError(res, 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً', 'SESSION_EXPIRED', 401);
    }

    const sessionData = JSON.parse(sessionDataRaw);

    // 🛡️ [SEC-FIX] Device Binding Check: Prevent Session Hijacking
    // Compares the request signature against the one established at login.
    const currentFingerprint = generateFingerprint(req);
    if (sessionData.fingerprint && sessionData.fingerprint !== currentFingerprint.hash) {
      logger.security('[SESSION_HIJACKING_DETECTED] Identity mismatch', { 
        userId, 
        jti, 
        stored: sessionData.fingerprint, 
        current: currentFingerprint.hash,
        ip: req.ip 
      });
      
      // 🚨 Immediate Revocation: Kill the compromised session
      await redis.del(`session:${userId}:${jti}`);
      return responseError(res, 'تنبيه أمني: تم اكتشاف محاولة وصول من جهاز غير معروف. يرجى تسجيل الدخول مجدداً.', 'SECURITY_BREACH', 401);
    }

    const currentRole = sessionData.role || decoded.role;
    const currentBranchId = sessionData.branchId || decoded.branchId;

    // 🏢 Extract requestedBranchId (already sanitized by global middleware)
    const reqBranchId = (req.query && req.query.branchId) || (req.body && req.body.branchId) || null;

    // Populate request with User Context using the LATEST data from Redis
    req.user = {
      id: userId, // This is the UUID
      phone: decoded.phone,
      role: (currentRole || '').toLowerCase(), // 🧠 Identity Normalization (Latest from Redis)
      branchId: currentBranchId || null,
      requestedBranchId: typeof reqBranchId === 'string' ? reqBranchId : null,
      jti: jti
    };

    // 🛡️ [PHASE 3] User Integrity Check (High-Speed)
    const SecurityPolicyService = require('../services/securityPolicyService');
    const FeatureFlagsService = require('../services/featureFlagsService');

    if (await FeatureFlagsService.isEnabled('ENFORCE_USER_STATUS_CHECK')) {
      try {
        const status = await SecurityPolicyService.checkUserStatus(userId);
        if (status && (status.isBlacklisted || !status.isActive)) {
          logger.security('BANNED_USER_ACCESS_ATTEMPT', { userId, status, ip: req.ip });
          return responseError(res, 'تم إيقاف حسابك، يرجى التواصل مع الإدارة', 'USER_SUSPENDED', 403);
        }
      } catch (err) {
        if (err.message === 'IDENTITY_NOT_FOUND') {
          return responseError(res, 'المستخدم غير موجود', 'USER_NOT_FOUND', 401);
        }
        logger.error('[AuthIntegrity] Status check failed', { error: err.message, stack: err.stack });
      }
    }
    
    const { runInContext } = require('../utils/securityContext');
    runInContext(req.user, () => next());
  } catch (error) {
    const isExpired = error.message === 'TOKEN_EXPIRED';
    const errorCode = isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    const message = isExpired ? 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول' : 'رمز الدخول غير صالح';

    logger.security(`Failed JWT validation: ${error.message}`, { 
      ip: req.ip, 
      endpoint: req.originalUrl,
      errorStack: error.stack
    });

    // 🚀 Critical Fix: 401 for Expired Tokens triggers client-side refresh logic
    return responseError(res, message, errorCode, 401);
  }
};

/**
 * 👑 Role Hierarchy Definition
 */
const ROLE_LEVELS = {
  'super_admin': 5, // Legacy support during migration
  'admin': 5,       // Unified admin role (Top tier)
  'branch_manager': 2,
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

const isAdmin = requireRoles(['admin', 'super_admin']);
const isManager = requireRoles(['admin', 'super_admin', 'branch_manager', 'manager']);
const isStaff = requireRoles('staff');

/**
 * 🟡 Optional Authentication Middleware
 */
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

    const { runInContext } = require('../utils/securityContext');

    if (!token) {
      req.user = null;
      return runInContext(null, () => next());
    }

    try {
      const decoded = TokenService.verifyAccessToken(token);
      const { id: userId, jti } = decoded;

      const sessionDataRaw = await redis.get(`session:${userId}:${jti}`);
      if (!sessionDataRaw) {
        req.user = null;
        return runInContext(null, () => next());
      }

      const sessionData = JSON.parse(sessionDataRaw);

      // 🛡️ [SEC-FIX] Device Binding Check (Optional Auth)
      const currentFingerprint = generateFingerprint(req);
      if (sessionData.fingerprint && sessionData.fingerprint !== currentFingerprint.hash) {
        logger.security('[SESSION_HIJACKING_DETECTED_OPTIONAL] Identity mismatch', { userId, jti, ip: req.ip });
        await redis.del(`session:${userId}:${jti}`);
        req.user = null;
        return runInContext(null, () => next());
      }

      const currentRole = sessionData.role || decoded.role;
      const currentBranchId = sessionData.branchId || decoded.branchId;

      let reqBranchId = (req.query && req.query.branchId) || (req.body && req.body.branchId) || null;
      if (Array.isArray(reqBranchId)) {
        reqBranchId = reqBranchId[0];
        if (req.query?.branchId) req.query.branchId = reqBranchId;
        if (req.body?.branchId) req.body.branchId = reqBranchId;
      }

      req.user = {
        id: userId,
        phone: decoded.phone,
        role: (currentRole || '').toLowerCase(),
        branchId: currentBranchId || null,
        requestedBranchId: typeof reqBranchId === 'string' ? reqBranchId : null,
        jti: jti
      };
      runInContext(req.user, () => next());
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
  isManager,
  isStaff,
  requireRoles,
  optionalAuth
};
