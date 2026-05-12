const biometricService = require('../services/biometricService');
const response = require('../utils/response');
const logger = require('../utils/logger');
const { REFRESH_TOKEN_EXPIRY_MS } = require('../config/secrets');

// Helper: Secure Cookie Config matching main Auth engine
const refreshCookieOptions = (req) => {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: REFRESH_TOKEN_EXPIRY_MS
  };
};

/**
 * 1. Enable/Register Biometric Binding for Authorized Contexts
 */
exports.enableBiometric = async (req, res) => {
  try {
    const { deviceId, metadata } = req.body;
    if (!deviceId) {
      return response.error(res, 'معرّف الجهاز المادي مطلوب', 'MISSING_DEVICE_ID', 400);
    }

    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return response.error(res, 'جلسة غير صالحة لربط البصمة', 'UNAUTHORIZED_CONTEXT', 401);
    }

    const clientMeta = {
      ...metadata,
      userAgent: req.headers['user-agent'],
      platform: req.headers['sec-ch-ua-platform'] || 'unknown',
      registeredAt: new Date().toISOString()
    };

    const result = await biometricService.enableDevice(currentUserId, deviceId, clientMeta, req);
    
    return response.success(res, {
      message: 'تم تفعيل الدخول بالبصمة بنجاح',
      biometricToken: result.biometricToken,
      deviceId: result.deviceId
    }, 201);
  } catch (error) {
    logger.error('Enable biometric engine crashed', { error: error.message });
    const code = error.message || 'INTERNAL_ERROR';
    const message = error.message === 'USER_INACTIVE' ? 'الحساب غير فعال' : 'حدث خطأ أثناء ربط البصمة';
    return response.error(res, message, code, 500);
  }
};

/**
 * 2. Unlock/Authenticate via Hardware Biometric Proof
 * Public endpoint passing hardware signatures to bypass standard web cache state drift.
 */
exports.unlockBiometric = async (req, res) => {
  try {
    const { biometricToken, deviceId } = req.body;
    if (!biometricToken || !deviceId) {
      return response.error(res, 'بيانات التحقق المادية غير مكتملة', 'MISSING_CREDENTIALS', 400);
    }

    const result = await biometricService.unlockDevice(biometricToken, deviceId, req);

    // Apply strict web runtime security cookies matching regular application lifecycle
    res.cookie('refreshToken', result.refreshToken, refreshCookieOptions(req));

    return response.success(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
      message: 'تم تسجيل الدخول بالبصمة بنجاح'
    });
  } catch (error) {
    logger.security('Biometric unlock attempt rejected', { error: error.message });
    
    if (error.message.includes('SECURITY_BREACH')) {
      return response.error(res, 'تنبيه أمني: عدم تطابق في بصمة الجهاز المادية. يرجى تسجيل الدخول بكلمة المرور.', 'SECURITY_BREACH_BIOMETRIC', 401);
    }
    if (error.message.includes('EXPIRED_OR_INVALID')) {
      return response.error(res, 'صلاحية البصمة منتهية أو غير صالحة. يرجى إعادة تفعيلها بعد الدخول.', 'BIOMETRIC_EXPIRED', 401);
    }
    if (error.message.includes('REVOKED') || error.message.includes('COMPROMISED')) {
      return response.error(res, 'تم إلغاء ربط هذا الجهاز مسبقاً. يرجى الدخول بكلمة المرور.', 'DEVICE_REVOKED', 403);
    }
    if (error.message.includes('DISABLED_OR_BLOCKED')) {
      return response.error(res, 'الحساب موقوف من قبل الإدارة', 'ACCOUNT_BLOCKED', 403);
    }

    return response.error(res, 'فشل التحقق من البصمة', 'BIOMETRIC_AUTH_FAILED', 401);
  }
};

/**
 * 3. Disable/Revoke Hardware Binding
 */
exports.disableBiometric = async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) {
      return response.error(res, 'معرّف الجهاز مطلوب', 'MISSING_DEVICE_ID', 400);
    }

    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return response.error(res, 'غير مصرح', 'UNAUTHORIZED', 401);
    }

    const success = await biometricService.disableDevice(currentUserId, deviceId, req);
    
    return response.success(res, {
      success,
      message: success ? 'تم إلغاء ربط الجهاز بنجاح' : 'الجهاز غير موجود أو ملغى مسبقاً'
    });
  } catch (error) {
    logger.error('Disable biometric failed', { error: error.message });
    return response.error(res, 'فشل إلغاء ربط الجهاز', 'DISABLE_FAILED', 500);
  }
};
