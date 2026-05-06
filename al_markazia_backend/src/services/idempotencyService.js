/**
 * 🛡️ Infrastructure Idempotency Service
 */
class IdempotencyService {
  constructor(container) {
    this.container = container;
    this.redis = container.redis;
    this.logger = container.logger;
    this.TTL = 3600;
  }

  async start(key) {
    if (!key) return true;
    const fullKey = `idempotency:${key}`;
    
    // 1. Try to acquire the idempotency lock
    let acquired = await this.redis.set(fullKey, 'processing', 'NX', 'EX', 300);
    
    // 2. If locked, the request might be in-flight. Use Smart Polling.
    if (!acquired) {
      this.logger.debug(`[Idempotency] Request ${key} is already processing. Polling for result...`);
      
      // Polling loop: Wait up to 3 seconds for the original request to complete
      for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const status = await this.redis.get(fullKey);
        
        // Success: Original request finished and saved the result
        if (status && status !== 'processing') {
          return false; // Tells the guard to return the existing result
        }
        
        // Recovery: Original request failed (Rollback). Try to take over.
        if (!status) {
          acquired = await this.redis.set(fullKey, 'processing', 'NX', 'EX', 300);
          if (acquired) return true;
        }
      }
      
      // Still processing after 3s: Reject to prevent hanging the client
      throw new Error('IDEMPOTENCY_LOCKED: الطلب قيد المعالجة حالياً، يرجى الانتظار لحظة.');
    }

    return true;
  }

  async commit(key, result) {
    if (!key) return;
    await this.redis.set(`idempotency:${key}`, JSON.stringify(result), 'EX', this.TTL);
  }

  async getResult(key) {
    if (!key) return null;
    const result = await this.redis.get(`idempotency:${key}`);
    return result && result !== 'processing' ? JSON.parse(result) : null;
  }

  async rollback(key) {
    if (!key) return;
    await this.redis.del(`idempotency:${key}`);
  }

  guard(required = false) {
    return (req, res, next) => {
      const key = req.headers['x-idempotency-key'];
      if (!key && required) {
        const response = require('../utils/response');
        return response.error(res, 'IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_KEY_REQUIRED', 400);
      }
      if (key) req.idempotencyKey = key;
      next();
    };
  }
}

// --- 🛡️ Backward Compatibility ---
const getContainer = () => require('../lib/container');
const proxy = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'IdempotencyService') return IdempotencyService;
    const service = getContainer().idempotencyService;
    const val = service[prop];
    return typeof val === 'function' ? val.bind(service) : val;
  }
});

module.exports = proxy;
module.exports.IdempotencyService = IdempotencyService;
