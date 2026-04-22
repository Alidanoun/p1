const redis = require('../lib/redis');
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * 🔐 Idempotency Service (Autonomous Level 7+)
 * Implements "High-Speed Guard" pattern using Redis to prevent race 
 * conditions and duplicate processing across distributed instances.
 */
class IdempotencyService {
  
  /**
   * Generates a unique signature for the request context.
   */
  static generateSignature(key, payload) {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHash('md5').update(`${key}:${data}`).digest('hex');
  }

  /**
   * Fast Redis-based lock.
   * @returns {boolean} True if the lock was acquired (First time).
   */
  static async acquireLock(signature, ttlSec = 3600) {
    const redisKey = `idempotency:lock:${signature}`;
    try {
      const result = await redis.set(redisKey, 'LOCKED', 'NX', 'EX', ttlSec);
      return result === 'OK';
    } catch (err) {
      logger.error('[Idempotency] Redis lock failed', { error: err.message });
      return true; // Fail-open to avoid blocking users if Redis is down
    }
  }

  /**
   * Middleware for Express routes.
   * Usage: app.post('/xxx', IdempotencyService.guard('MISSION_CRITICAL'), ...)
   */
  static guard() {
    return async (req, res, next) => {
      const idKey = req.headers['x-idempotency-key'] || req.headers['idempotency-key'];
      
      if (!idKey) {
        return next();
      }

      const signature = this.generateSignature(req.path, idKey);
      const isNew = await this.acquireLock(signature);

      if (!isNew) {
        logger.warn(`[Idempotency] 🛡️ Duplicate Request Blocked`, { 
          path: req.path, 
          key: idKey 
        });
        
        return res.status(409).json({
          error: 'طلب مكرر',
          message: 'نحن نعالج هذا الطلب بالفعل. يرجى مراجعة سجل الطلبات الخاص بك.'
        });
      }

      next();
    };
  }
}

module.exports = IdempotencyService;
