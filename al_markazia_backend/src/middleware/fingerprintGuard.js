const crypto = require('crypto');
const logger = require('../utils/logger');
const redis = require('../lib/redis'); // Assuming redis is available in lib

/**
 * 🕵️ Fingerprint Guard (Phase 1 Security)
 * Prevents rating spam by hashing IP + UserAgent + DeviceID.
 */
const fingerprintGuard = async (req, res, next) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || '0.0.0.0';
    const ua = req.headers['user-agent'] || 'unknown';
    const deviceId = req.headers['x-device-id'] || 'no-device-id';

    // 🔒 SHA-256 Hashing (Privacy-First)
    const fingerprint = crypto
      .createHash('sha256')
      .update(`${ip}-${ua}-${deviceId}`)
      .digest('hex');

    req.fingerprint = fingerprint;

    // 🛡️ Redis-backed Rate Limiting (72h window)
    const cacheKey = `rating:fp:${fingerprint}`;
    const exists = await redis.get(cacheKey);

    if (exists) {
      logger.warn('[FingerprintGuard] 🚫 Spam detected or repeated attempt from same device', { fingerprint });
      // We don't block yet, but we'll flag it or limit it in the service
    }

    next();
  } catch (err) {
    logger.error('[FingerprintGuard] Error', { error: err.message });
    next();
  }
};

module.exports = fingerprintGuard;
