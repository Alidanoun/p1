const prisma = require('../lib/prisma');
const { v4: uuidv4 } = require('uuid');

/**
 * 🛡️ Robust Idempotency Service (DB + Redis Hybrid)
 * Purpose: Prevents duplicate operations and ensures consistent responses for retries.
 * 
 * Flow:
 * 1. Check DB for existing key.
 * 2. If exists and COMPLETED: Return saved response.
 * 3. If exists and PENDING: Return 409 Conflict.
 * 4. If new: Create PENDING record and proceed.
 */
class IdempotencyService {
  constructor(container) {
    this.container = container;
    this.redis = container.redis;
    this.logger = container.logger;
    this.TTL_SECONDS = 86400; // 24 hours
  }

  /**
   * 🚀 Start Idempotency Check
   * Returns: { status: 'NEW' | 'COMPLETED' | 'PENDING', response: Object }
   */
  async start(key, operation, userId = null) {
    if (!key) return { status: 'NEW' };

    // 1. Check Database (The Source of Truth)
    const existing = await prisma.idempotencyKey.findUnique({
      where: { key }
    });

    if (existing) {
      if (existing.status === 'COMPLETED') {
        this.logger.info(`[Idempotency] ♻️ Reusing saved response for key: ${key}`);
        return { status: 'COMPLETED', response: existing.responsePayload };
      }
      if (existing.status === 'PENDING') {
        this.logger.warn(`[Idempotency] ⏳ Request already in progress for key: ${key}`);
        throw new Error('IDEMPOTENCY_LOCKED: Request is already being processed.');
      }
    }

    // 2. Create PENDING record
    try {
      await prisma.idempotencyKey.create({
        data: {
          key,
          operation,
          userId: userId?.toString(),
          status: 'PENDING',
          expiresAt: new Date(Date.now() + this.TTL_SECONDS * 1000)
        }
      });
      return { status: 'NEW' };
    } catch (err) {
      // Handle race condition if two requests hit at exact same millisecond
      if (err.code === 'P2002') {
         throw new Error('IDEMPOTENCY_LOCKED: Request already exists.');
      }
      throw err;
    }
  }

  /**
   * ✅ Commit Result
   */
  async commit(key, result) {
    if (!key) return;
    await prisma.idempotencyKey.update({
      where: { key },
      data: {
        status: 'COMPLETED',
        responsePayload: result
      }
    });
  }

  /**
   * ❌ Rollback on Failure
   */
  async rollback(key) {
    if (!key) return;
    await prisma.idempotencyKey.delete({ where: { key } }).catch(() => {});
  }

  /**
   * 🛠️ Helper to generate a valid key (UUID v4)
   */
  generateKey() {
    return uuidv4();
  }

  /**
   * 🛡️ Middleware Guard
   */
  guard(required = false) {
    return (req, res, next) => {
      const key = req.headers['x-idempotency-key'];
      if (!key && required) {
        return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
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
