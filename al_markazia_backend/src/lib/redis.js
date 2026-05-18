const Redis = require('ioredis');
const logger = require('../utils/logger');

const baseConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null,
  connectTimeout: 3000,
};

// 🛡️ Decorrelated Retry Strategy with Jitter to prevent Thundering Herd
const createRetryStrategy = (clientLabel) => (times) => {
  if (times > 10) return 5000; // Cap backoff at fixed 5s after 10 attempts
  const baseDelay = times * 100;
  // Separate coordination timelines: Cache retries faster, coordination adds larger jitter
  const jitter = clientLabel === 'Cache' ? Math.random() * 100 : Math.random() * 300;
  return Math.min(baseDelay + jitter, 2000);
};

// 🧠 In-Memory Resilient Fallback Store
class InMemoryRedisFallback {
  constructor() {
    this.store = new Map();
    this.expirations = new Map();
  }

  _isExpired(key) {
    const expiresAt = this.expirations.get(key);
    if (expiresAt && Date.now() > expiresAt) {
      this.store.delete(key);
      this.expirations.delete(key);
      return true;
    }
    return false;
  }

  async get(key) {
    if (this._isExpired(key)) return null;
    const val = this.store.get(key);
    return val !== undefined ? String(val) : null;
  }

  async set(key, value, ...args) {
    this.store.set(key, String(value));
    
    // Parse EX/PX
    if (args && args.length >= 2) {
      const option = String(args[0]).toUpperCase();
      const val = parseInt(args[1], 10);
      if (option === 'EX') {
        this.expirations.set(key, Date.now() + val * 1000);
      } else if (option === 'PX') {
        this.expirations.set(key, Date.now() + val);
      }
    }
    return 'OK';
  }

  async setex(key, seconds, value) {
    this.store.set(key, String(value));
    this.expirations.set(key, Date.now() + parseInt(seconds, 10) * 1000);
    return 'OK';
  }

  async del(...keys) {
    let deletedCount = 0;
    const flatKeys = keys.flat();
    for (const key of flatKeys) {
      if (this.store.has(key)) {
        this.store.delete(key);
        this.expirations.delete(key);
        deletedCount++;
      }
    }
    return deletedCount;
  }

  async incr(key) {
    if (this._isExpired(key)) {
      this.store.set(key, '1');
      return 1;
    }
    const val = this.store.get(key);
    const num = val !== undefined ? parseInt(val, 10) : 0;
    const newVal = num + 1;
    this.store.set(key, String(newVal));
    return newVal;
  }

  async expire(key, seconds) {
    if (this.store.has(key)) {
      this.expirations.set(key, Date.now() + parseInt(seconds, 10) * 1000);
      return 1;
    }
    return 0;
  }

  async keys(pattern) {
    const results = [];
    const regexPattern = pattern
      .replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&') // escape regex
      .replace(/\*/g, '.*'); // * to .*
    const regex = new RegExp(`^${regexPattern}$`);

    for (const key of this.store.keys()) {
      if (!this._isExpired(key) && regex.test(key)) {
        results.push(key);
      }
    }
    return results;
  }

  // Hash support
  async hget(key, field) {
    if (this._isExpired(key)) return null;
    const hash = this.store.get(key);
    if (hash instanceof Map) {
      const val = hash.get(field);
      return val !== undefined ? String(val) : null;
    }
    return null;
  }

  async hset(key, field, value) {
    if (this._isExpired(key)) {
      this.store.delete(key);
    }
    let hash = this.store.get(key);
    if (!(hash instanceof Map)) {
      hash = new Map();
      this.store.set(key, hash);
    }
    hash.set(field, String(value));
    return 1;
  }

  async hdel(key, ...fields) {
    if (this._isExpired(key)) return 0;
    const hash = this.store.get(key);
    if (hash instanceof Map) {
      let deleted = 0;
      for (const field of fields.flat()) {
        if (hash.delete(field)) {
          deleted++;
        }
      }
      return deleted;
    }
    return 0;
  }

  async hgetall(key) {
    if (this._isExpired(key)) return {};
    const hash = this.store.get(key);
    if (hash instanceof Map) {
      const obj = {};
      for (const [k, v] of hash.entries()) {
        obj[k] = v;
      }
      return obj;
    }
    return {};
  }

  // Set support
  async sadd(key, ...members) {
    if (this._isExpired(key)) {
      this.store.delete(key);
    }
    let set = this.store.get(key);
    if (!(set instanceof Set)) {
      set = new Set();
      this.store.set(key, set);
    }
    let added = 0;
    for (const member of members.flat()) {
      if (!set.has(String(member))) {
        set.add(String(member));
        added++;
      }
    }
    return added;
  }

  async srem(key, ...members) {
    if (this._isExpired(key)) return 0;
    const set = this.store.get(key);
    if (set instanceof Set) {
      let removed = 0;
      for (const member of members.flat()) {
        if (set.delete(String(member))) {
          removed++;
        }
      }
      return removed;
    }
    return 0;
  }

  async smembers(key) {
    if (this._isExpired(key)) return [];
    const set = this.store.get(key);
    if (set instanceof Set) {
      return Array.from(set);
    }
    return [];
  }

  async sismember(key, member) {
    if (this._isExpired(key)) return 0;
    const set = this.store.get(key);
    if (set instanceof Set) {
      return set.has(String(member)) ? 1 : 0;
    }
    return 0;
  }

  async ping() {
    return 'PONG';
  }

  async quit() {
    return 'OK';
  }

  async publish(channel, message) {
    return 1;
  }

  async subscribe(channel) {
    return 'OK';
  }

  // Local Rate-limiting LUA script emulation
  async eval(script, numkeys, key, maxRequests, windowSecs, now, requestId) {
    const currentVal = await this.get(key);
    if (!currentVal) {
      await this.set(key, '1', 'EX', windowSecs);
      return [1, 1];
    }
    
    const count = parseInt(currentVal, 10);
    if (count >= maxRequests) {
      return [0, count];
    }
    
    const newCount = await this.incr(key);
    return [1, newCount];
  }
}

const fallbackStore = new InMemoryRedisFallback();

// 🛡️ Wrapping Redis client to intercept connection failures and use fallback
function makeResilient(redisClient, label) {
  return new Proxy(redisClient, {
    get(target, prop, receiver) {
      // 1. Return special properties/methods directly
      if (prop === 'cache' || prop === 'publisher' || prop === 'subscriber' || prop === 'socketSubscriber') {
        return target[prop];
      }
      
      // 2. Intercept command methods if defined in fallbackStore
      if (typeof fallbackStore[prop] === 'function') {
        return function(...args) {
          const isConnected = target.status === 'ready';
          
          if (!isConnected) {
            logger.debug(`[RedisFallback:${label}] Redis offline. Fallback to In-Memory Map for '${String(prop)}'`);
            return fallbackStore[prop](...args);
          }

          // Try real Redis, catch error if it fails
          try {
            const result = target[prop](...args);
            if (result && typeof result.catch === 'function') {
              return result.catch((err) => {
                logger.warn(`[RedisError:${label}] Command failed on Redis, falling back to memory Map`, {
                  command: String(prop),
                  error: err.message
                });
                return fallbackStore[prop](...args);
              });
            }
            return result;
          } catch (err) {
            logger.warn(`[RedisException:${label}] Command threw error, falling back to memory Map`, {
              command: String(prop),
              error: err.message
            });
            return fallbackStore[prop](...args);
          }
        };
      }
      
      return Reflect.get(target, prop, receiver);
    }
  });
}

// 💎 DB 0: Primary Cache & Shared State (with fail-fast protection)
const cache = new Redis({ ...baseConfig, db: 0, commandTimeout: 3000, retryStrategy: createRetryStrategy('Cache') });

// 📡 DB 1: Distributed Event Bus (Pub/Sub)
const publisher = new Redis({ ...baseConfig, db: 1, commandTimeout: 3000, retryStrategy: createRetryStrategy('Pub') });
const subscriber = new Redis({ ...baseConfig, db: 1, enableReadyCheck: false, retryStrategy: createRetryStrategy('Sub') });
const socketSubscriber = new Redis({ ...baseConfig, db: 1, enableReadyCheck: false, retryStrategy: createRetryStrategy('Socket') });

const clients = [cache, publisher, subscriber, socketSubscriber];

clients.forEach((client, index) => {
  client.on('connect', () => {
    const labels = ['Cache', 'Publisher', 'Subscriber', 'SocketSubscriber'];
    logger.info(`Redis [${labels[index]}] connected successfully to DB ${client.options.db}`);
  });

  client.on('error', (err) => {
    logger.error(`Redis connection error`, { error: err.message });
  });
});

const createSubscriber = () => new Redis({ ...baseConfig, db: 1, enableReadyCheck: false, retryStrategy: createRetryStrategy('Sub') });

// 🛡️ Shield child/cloned connections (like in BullMQ or custom workers) from inheriting commandTimeout
const originalOptions = cache.options;
Object.defineProperty(cache, 'options', {
  get() {
    const opts = { ...originalOptions };
    delete opts.commandTimeout;
    return opts;
  },
  configurable: true,
  enumerable: true
});

const originalDuplicate = cache.duplicate.bind(cache);
cache.duplicate = (overrideOptions) => {
  return originalDuplicate({ commandTimeout: undefined, ...overrideOptions });
};

// 🛰️ Hybrid Resilient Redis Export
const resilientCache = makeResilient(cache, 'Cache');
const resilientPublisher = makeResilient(publisher, 'Publisher');
const resilientSubscriber = makeResilient(subscriber, 'Subscriber');
const resilientSocketSubscriber = makeResilient(socketSubscriber, 'SocketSubscriber');

resilientCache.cache = resilientCache;
resilientCache.publisher = resilientPublisher;
resilientCache.subscriber = resilientSubscriber;
resilientCache.socketSubscriber = resilientSocketSubscriber;
resilientCache.createSubscriber = () => makeResilient(createSubscriber(), 'Sub');
resilientCache.getRedis = () => resilientCache;

module.exports = resilientCache;
