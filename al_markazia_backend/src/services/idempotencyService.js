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
   * @param {string} key - The provided idempotency key
   * @param {string} operation - Name of the operation
   * @param {object} payload - The request payload (for hashing)
   * @param {object} actor - The user performing the action
   */
  async start(key, operation, payload, actor) {
    if (!key) return { status: 'NEW' };

    const branchId = require('../utils/context').getBranchId();
    const compoundKey = branchId ? `br:${branchId}:${key}` : key;

    // 1. Check Database
    const existing = await prisma.idempotencyKey.findUnique({
      where: { key: compoundKey }
    });

    if (existing) {
      // 🕵️ SECURITY: If the key matches but the operation is different, it's a conflict or collision
      if (existing.operation !== operation) {
         throw new Error('IDEMPOTENCY_MISMATCH: Key used for a different operation.');
      }

      if (existing.status === 'COMPLETED') {
        this.logger.reasoning(`Returning cached response for key: ${compoundKey}. (Operation: ${operation})`, { compoundKey });
        return { status: 'COMPLETED', response: existing.responsePayload };
      }
      
      if (existing.status === 'PENDING') {
        this.logger.reasoning(`Rejecting concurrent request for key: ${compoundKey}. Rationale: Operation already in progress.`, { compoundKey });
        throw new Error('IDEMPOTENCY_LOCKED: Request is already being processed.');
      }
    }

    // 2. Create PENDING record
    try {
      await prisma.idempotencyKey.create({
        data: {
          key: compoundKey,
          operation,
          userId: actor?.id?.toString(),
          status: 'PENDING',
          expiresAt: new Date(Date.now() + this.TTL_SECONDS * 1000)
        }
      });
      return { status: 'NEW' };
    } catch (err) {
      if (err.code === 'P2002') throw new Error('IDEMPOTENCY_LOCKED');
      throw err;
    }
  }

  async commit(key, result) {
    if (!key) return;
    const branchId = require('../utils/context').getBranchId();
    const compoundKey = branchId ? `br:${branchId}:${key}` : key;

    await prisma.idempotencyKey.update({
      where: { key: compoundKey },
      data: {
        status: 'COMPLETED',
        responsePayload: result
      }
    });
  }

  async rollback(key) {
    if (!key) return;
    const branchId = require('../utils/context').getBranchId();
    const compoundKey = branchId ? `br:${branchId}:${key}` : key;
    await prisma.idempotencyKey.delete({ where: { key: compoundKey } }).catch(() => {});
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
