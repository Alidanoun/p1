/**
 * 🛡️ Infrastructure Idempotency Service
 * Prevents duplicate request processing at the infrastructure level.
 * Uses Redis as a high-speed lock and result cache.
 */

const redis = require('../lib/redis');
const logger = require('../utils/logger');

class IdempotencyService {
  constructor() {
    this.TTL = 3600; // 1 hour default
  }

  /**
   * 🔒 Start processing a request
   * Returns true if request is unique and can proceed.
   */
  async start(key) {
    if (!key) return true; // Bypass if no key provided

    const fullKey = `idempotency:${key}`;
    
    // Attempt to set 'processing' status with NX (Only if not exists)
    const acquired = await redis.set(fullKey, 'processing', 'NX', 'EX', 300); // 5 min lock
    
    if (!acquired) {
      const status = await redis.get(fullKey);
      if (status === 'processing') {
        throw new Error('IDEMPOTENCY_LOCKED: Request already in progress.');
      }
      return false; // Already completed (will be handled by getResult)
    }

    return true;
  }

  /**
   * 💾 Save final result of a request
   */
  async commit(key, result) {
    if (!key) return;
    const fullKey = `idempotency:${key}`;
    await redis.set(fullKey, JSON.stringify(result), 'EX', this.TTL);
    logger.debug(`[Idempotency] Result committed for key: ${key}`);
  }

  /**
   * 🔍 Get cached result for a key
   */
  async getResult(key) {
    if (!key) return null;
    const result = await redis.get(`idempotency:${key}`);
    return result && result !== 'processing' ? JSON.parse(result) : null;
  }

  /**
   * ❌ Rollback in case of failure
   */
  async rollback(key) {
    if (!key) return;
    await redis.del(`idempotency:${key}`);
  }

  /**
   * 🛡️ HTTP Middleware Guard
   * Extracts idempotency key from headers for use in downstream logic.
   */
  guard() {
    return (req, res, next) => {
      const key = req.headers['x-idempotency-key'];
      if (key) {
        req.idempotencyKey = key;
      }
      next();
    };
  }
}

module.exports = new IdempotencyService();
