const tokenBlacklistService = require('../services/tokenBlacklistService');
const logger = require('../utils/logger');

exports.checkTokenNotBlacklisted = async (req, res, next) => {
  if (process.env.ENABLE_TOKEN_BLACKLIST === 'false') {
    return next();
  }

  try {
    const jti = req.user?.jti;  // من JWT decode
    if (!jti) return next();
    
    const isBlacklisted = await tokenBlacklistService.isBlacklisted(jti);
    if (isBlacklisted) {
      logger.security('[BLACKLISTED_TOKEN_USED]', { 
        userId: req.user?.id, jti, ip: req.ip 
      });
      return res.status(401).json({
        error: 'SESSION_REVOKED',
        message: 'تم إنهاء هذه الجلسة، يرجى تسجيل الدخول مجدداً'
      });
    }
    
    next();
  } catch (error) {
    // ⚠️ Fail-Open للـ Redis: إذا تعطل، نسمح بالمرور مع تسجيل التحذير
    logger.warn('[BlacklistCheckFailed]', { error: error.message });
    next();
  }
};
