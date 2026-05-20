const prisma = require('../lib/prisma');
const { randomUUID } = require('crypto');

/**
 * 🛡️ Robust Idempotency Service (DB + Redis Hybrid with Exponential Backoff + Jitter)
 * Purpose: Prevents duplicate operations, eliminates Thundering Herd race conditions,
 * and ensures consistent responses for retries under extremely high concurrency.
 * 
 * Flow:
 * 1. Check Redis for immediate ultra-fast response caching.
 * 2. Check Database for existing completed keys (defense-in-depth).
 * 3. Distributed Redis lock acquisition with dynamic waiting loop using Exponential Backoff + Jitter.
 * 4. Stale lock recovery and automatic DB metrics tracking parity.
 */
class IdempotencyService {
  constructor(container) {
    this.container = container;
    this.redis = container.redis;
    this.logger = container.logger;
    this.TTL_SECONDS = 86400; // 24 hours

    // ✅ Configurable retry & delay parameters
    this.config = {
      ttl: 86400,           // 24 hours for final cached result
      lockTtl: 300,         // 5 minutes for active processing lock
      maxRetries: 5,        // Maximum backoff wait attempts
      baseDelay: 100,       // 100ms starting base delay
      maxDelay: 5000,       // 5 seconds max delay ceiling
      jitterFactor: 0.1     // 10% randomness factor to eliminate Thundering Herd concurrency spikes
    };
  }

  /**
   * ✅ Calculate Exponential Backoff Delay with Jitter
   * Prevents Thundering Herd Problem by randomizing wake-up intervals
   */
  _calculateDelay(retryCount) {
    // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms...
    const exponential = Math.min(
      this.config.baseDelay * Math.pow(2, retryCount),
      this.config.maxDelay
    );
    
    // Jitter: add random ±10% deviation to break lockstep synchronization
    const jitter = exponential * this.config.jitterFactor * Math.random();
    const delay = exponential + jitter;
    
    return Math.ceil(delay);
  }

  /**
   * ✅ Sleep Helper Promise
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 🚀 Start Idempotency Check with High Concurrency Protection
   * @param {string} key - The provided idempotency key
   * @param {string} operation - Name of the operation
   * @param {object} payload - The request payload (for hashing/context)
   * @param {object} actor - The user performing the action
   */
  async start(key, operation, payload, actor) {
    if (!key) return { status: 'NEW' };

    const branchId = require('../utils/context').getBranchId();
    const compoundKey = branchId ? `br:${branchId}:${key}` : key;
    const redisKey = `idempotency:${compoundKey}`;
    const lockId = randomUUID();

    // 1️⃣ Fast Path: Check Redis cache directly for completed state
    try {
      const cachedData = await this.redis.get(redisKey);
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        if (parsed.status === 'COMPLETED' || parsed.status === 'completed') {
          // 🕵️ SECURITY: Verify operation consistency to detect hash collisions or parameter tampering
          if (parsed.operation && parsed.operation !== operation) {
            throw new Error('IDEMPOTENCY_MISMATCH: Key used for a different operation.');
          }
          if (this.logger && typeof this.logger.reasoning === 'function') {
            this.logger.reasoning(`Returning Redis cached response for key: ${compoundKey}. (Operation: ${operation})`, { compoundKey });
          } else if (this.logger && typeof this.logger.info === 'function') {
            this.logger.info(`Returning Redis cached response for key: ${compoundKey}. (Operation: ${operation})`, { compoundKey });
          }
          return { status: 'COMPLETED', response: parsed.result };
        }
      }
    } catch (redisErr) {
      if (redisErr.message && redisErr.message.includes('IDEMPOTENCY_MISMATCH')) {
        throw redisErr;
      }
      if (this.logger && typeof this.logger.warn === 'function') {
        this.logger.warn(`[Idempotency] Redis cache read failed: ${compoundKey}`, { error: redisErr.message });
      }
    }

    // 2️⃣ Persistent Layer Check: Verify DB for completed keys evicted or missing from Redis
    let existing = null;
    try {
      existing = await prisma.idempotencyKey.findUnique({
        where: { key: compoundKey }
      });

      if (existing) {
        if (existing.operation !== operation) {
          throw new Error('IDEMPOTENCY_MISMATCH: Key used for a different operation.');
        }

        if (existing.status === 'COMPLETED') {
          if (this.logger && typeof this.logger.reasoning === 'function') {
            this.logger.reasoning(`Returning DB cached response for key: ${compoundKey}. (Operation: ${operation})`, { compoundKey });
          }
          // Optionally warm up the Redis cache for subsequent calls
          const warmUpValue = JSON.stringify({
            status: 'COMPLETED',
            operation: existing.operation,
            result: existing.responsePayload,
            completedAt: existing.updatedAt || new Date().toISOString()
          });
          await this.redis.setex(redisKey, this.config.ttl, warmUpValue).catch(() => {});
          return { status: 'COMPLETED', response: existing.responsePayload };
        }
      }
    } catch (dbErr) {
      if (dbErr.message && dbErr.message.includes('IDEMPOTENCY_MISMATCH')) {
        throw dbErr;
      }
      if (this.logger && typeof this.logger.warn === 'function') {
        this.logger.warn(`[Idempotency] DB read degraded for key: ${compoundKey}`, { error: dbErr.message });
      }
    }

    // 3️⃣ Distributed Lock Acquisition with Dynamic Sync
    const lockValue = JSON.stringify({ 
      status: 'processing', 
      operation,
      lockId, 
      acquiredAt: Date.now() 
    });

    let acquired = false;
    try {
      acquired = await this.redis.set(
        redisKey, 
        lockValue, 
        'NX', 
        'EX', 
        this.config.lockTtl
      );
    } catch (lockErr) {
      if (this.logger && typeof this.logger.error === 'function') {
        this.logger.error(`[Idempotency] Redis locking command failed: ${compoundKey}`, { error: lockErr.message });
      }
      // If Redis locking completely fails, fall back to DB optimistic execution or throw specific lock error
      throw new Error('IDEMPOTENCY_LOCKED');
    }

    if (acquired) {
      if (this.logger && typeof this.logger.debug === 'function') {
        this.logger.debug(`[Idempotency] Lock acquired: ${compoundKey}`, { lockId });
      }
      // Keep DB record in sync so system metrics/health monitors tracking DB records reflect active keys
      try {
        if (!existing) {
          await prisma.idempotencyKey.create({
            data: {
              key: compoundKey,
              operation,
              userId: actor?.id?.toString(),
              status: 'PENDING',
              expiresAt: new Date(Date.now() + this.config.ttl * 1000)
            }
          });
        }
      } catch (createErr) {
        // Unique constraint errors during concurrent record creation are safely ignored because we hold the secure Redis distributed lock.
      }
      return { status: 'NEW' };
    }

    // 4️⃣ Waiting Loop: Queuing with Exponential Backoff + Jitter to eliminate Thundering Herd
    let retryCount = 0;

    while (retryCount < this.config.maxRetries) {
      const delay = this._calculateDelay(retryCount);

      if (this.logger && typeof this.logger.debug === 'function') {
        this.logger.debug(`[Idempotency] Waiting for ${compoundKey}`, {
          attempt: retryCount + 1,
          delay,
          lockId
        });
      }

      await this._sleep(delay);

      try {
        const lockData = await this.redis.get(redisKey);

        // Case A: Active lock expired or disappeared from Redis (original request crashed or rolled back)
        if (!lockData) {
          const canAcquire = await this.redis.set(
            redisKey, 
            lockValue, 
            'NX', 
            'EX', 
            this.config.lockTtl
          );

          if (canAcquire) {
            if (this.logger && typeof this.logger.warn === 'function') {
              this.logger.warn(`[Idempotency] Lock takeover: ${compoundKey}`, { lockId });
            }
            // Ensure record status reflects PENDING if taking over
            await prisma.idempotencyKey.upsert({
              where: { key: compoundKey },
              update: { status: 'PENDING', operation },
              create: {
                key: compoundKey,
                operation,
                userId: actor?.id?.toString(),
                status: 'PENDING',
                expiresAt: new Date(Date.now() + this.config.ttl * 1000)
              }
            }).catch(() => {});
            return { status: 'NEW' };
          }
          retryCount++;
          continue;
        }

        // Case B: Parse Active Lock Data
        const lock = JSON.parse(lockData);

        // Verify operation safety consistency
        if (lock.operation && lock.operation !== operation) {
          throw new Error('IDEMPOTENCY_MISMATCH: Key used for a different operation.');
        }

        if (lock.status === 'COMPLETED' || lock.status === 'completed') {
          if (this.logger && typeof this.logger.debug === 'function') {
            this.logger.debug(`[Idempotency] Request completed during wait: ${compoundKey}`);
          }
          return { status: 'COMPLETED', response: lock.result };
        }

        if (lock.status === 'processing' || lock.status === 'PENDING') {
          // Stale lock recovery mechanism: protect against orphaned or deadlocked processes
          const lockAge = Date.now() - (lock.acquiredAt || 0);
          if (lockAge > this.config.lockTtl * 1000) {
            if (this.logger && typeof this.logger.warn === 'function') {
              this.logger.warn(`[Idempotency] Stale lock detected and recovered: ${compoundKey}`);
            }
            await this.redis.del(redisKey);
          }
        }

      } catch (waitLoopErr) {
        // If parsing fails or mismatch occurs, log and retry/break appropriately
        if (waitLoopErr.message && waitLoopErr.message.includes('IDEMPOTENCY_MISMATCH')) {
          throw waitLoopErr;
        }
        if (this.logger && typeof this.logger.error === 'function') {
          this.logger.error(`[Idempotency] Loop cycle execution failure: ${compoundKey}`, { error: waitLoopErr.message });
        }
      }

      retryCount++;
    }

    // 5️⃣ Maximum retries exhausted
    if (this.logger && typeof this.logger.error === 'function') {
      this.logger.error(`[Idempotency] Max retries exceeded: ${compoundKey}`, {
        retryCount,
        maxRetries: this.config.maxRetries
      });
    }

    throw new Error('IDEMPOTENCY_TIMEOUT: الطلب قيد المعالجة، يرجى المحاولة لاحقاً');
  }

  /**
   * ✅ Commit Final Result Safely to Distributed Cache and Storage
   */
  async commit(key, result) {
    if (!key) return;
    const branchId = require('../utils/context').getBranchId();
    const compoundKey = branchId ? `br:${branchId}:${key}` : key;
    const redisKey = `idempotency:${compoundKey}`;

    try {
      let operation = 'unknown';
      const lockData = await this.redis.get(redisKey).catch(() => null);
      if (lockData) {
        try {
          const lock = JSON.parse(lockData);
          if (lock.operation) operation = lock.operation;
        } catch (e) {}
      }

      const finalValue = JSON.stringify({
        status: 'COMPLETED',
        operation,
        result,
        completedAt: new Date().toISOString()
      });

      // Long cache residence for ultimate responsiveness
      await this.redis.setex(redisKey, this.config.ttl, finalValue);

      // Persistent record sync to maintain system monitor metric parity
      await prisma.idempotencyKey.update({
        where: { key: compoundKey },
        data: {
          status: 'COMPLETED',
          responsePayload: result
        }
      }).catch(() => {});

      if (this.logger && typeof this.logger.debug === 'function') {
        this.logger.debug(`[Idempotency] Result committed: ${compoundKey}`);
      }
    } catch (error) {
      if (this.logger && typeof this.logger.error === 'function') {
        this.logger.error(`[Idempotency] Failed to commit result: ${compoundKey}`, { error: error.message });
      }
    }
  }

  /**
   * ✅ Retrieve cached response if available directly (Requested interface helper)
   */
  async getResult(key) {
    if (!key) return null;
    const branchId = require('../utils/context').getBranchId();
    const compoundKey = branchId ? `br:${branchId}:${key}` : key;
    const redisKey = `idempotency:${compoundKey}`;

    const lockData = await this.redis.get(redisKey).catch(() => null);
    if (!lockData) return null;

    try {
      const lock = JSON.parse(lockData);
      if (lock.status === 'COMPLETED' || lock.status === 'completed') {
        return lock.result;
      }
      return null;
    } catch (error) {
      if (this.logger && typeof this.logger.warn === 'function') {
        this.logger.warn(`[Idempotency] Failed to parse result payload: ${compoundKey}`);
      }
      return null;
    }
  }

  /**
   * ✅ Rollback and release active locks upon gateway lifecycle or process failure
   */
  async rollback(key) {
    if (!key) return;
    const branchId = require('../utils/context').getBranchId();
    const compoundKey = branchId ? `br:${branchId}:${key}` : key;
    const redisKey = `idempotency:${compoundKey}`;

    try {
      await this.redis.del(redisKey);
      await prisma.idempotencyKey.delete({ where: { key: compoundKey } }).catch(() => {});
      if (this.logger && typeof this.logger.debug === 'function') {
        this.logger.debug(`[Idempotency] Lock rolled back successfully: ${compoundKey}`);
      }
    } catch (error) {
      if (this.logger && typeof this.logger.error === 'function') {
        this.logger.error(`[Idempotency] Failed to rollback lock: ${compoundKey}`, { error: error.message });
      }
    }
  }

  /**
   * 🛠️ Helper to generate a valid key (UUID v4)
   */
  generateKey() {
    return randomUUID();
  }

  /**
   * 🛡️ Middleware Guard
   */
  guard(required = false) {
    return (req, res, next) => {
      const key = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];

      if (!key && required) {
        return res.status(400).json({
          success: false,
          error: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'مطلوب هيدر Idempotency-Key فريد (UUID) مع كل طلب شراء',
          code: 'IDEMPOTENCY_KEY_REQUIRED'
        });
      }

      if (key) {
        // Validate UUID format to prevent abuse with arbitrary strings
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(key)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_IDEMPOTENCY_KEY',
            message: 'معرف المعاملة يجب أن يكون بصيغة UUID صحيحة',
            code: 'INVALID_IDEMPOTENCY_KEY'
          });
        }
        req.idempotencyKey = key;
      }

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
