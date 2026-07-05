require('dotenv').config();
const Redis = require('ioredis');
const logger = require('../utils/logger');

// 🔗 Support REDIS_URL connection string (Local, Docker, etc.)
// Falls back to individual REDIS_HOST/PORT/PASSWORD if REDIS_URL is not set.
function buildRedisConfig() {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl);
      return {
        host: parsed.hostname,
        port: parseInt(parsed.port, 10) || 6379,
        username: parsed.username || undefined,
        password: parsed.password || undefined,
        maxRetriesPerRequest: null,
        connectTimeout: 15000,
      };
    } catch (e) {
      logger.warn('[Redis] Failed to parse REDIS_URL, falling back to individual env vars', { error: e.message });
    }
  }
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    connectTimeout: 15000,
  };
}

const baseConfig = buildRedisConfig();

// 🛡️ Decorrelated Retry Strategy with Jitter — gives up after a few attempts
const createRetryStrategy = (clientLabel) => (times) => {
  if (times > 3) {
    logger.warn(`[Redis:${clientLabel}] Giving up after ${times} retries. Using in-memory fallback.`);
    return null; // Stop retrying — null tells ioredis to stop
  }
  const baseDelay = times * 200;
  const jitter = clientLabel === 'Cache' ? Math.random() * 100 : Math.random() * 300;
  return Math.min(baseDelay + jitter, 2000);
};

// 🧠 In-Memory Resilient Fallback Store
class InMemoryRedisFallback {
  constructor() {
    this.store = new Map();
    this.expirations = new Map();
    this.streams = new Map();
    this.streamOffsets = new Map();
  }

  // 🛰️ Redis Streams In-Memory Emulation
  async xgroup(cmd, key, group, ...args) {
    return 'OK';
  }

  async xadd(key, ...args) {
    const starIndex = args.indexOf('*');
    const fields = starIndex !== -1 ? args.slice(starIndex + 1) : args;
    const id = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    if (!this.streams.has(key)) {
      this.streams.set(key, []);
    }
    this.streams.get(key).push({ id, fields });
    return id;
  }

  async xreadgroup(groupWord, groupName, consumerName, blockWord, blockTimeout, countWord, count, streamsWord, streamKey, lastIdOption) {
    const offsetKey = `${streamKey}:${groupName}`;
    const currentOffset = this.streamOffsets.get(offsetKey) || 0;
    const stream = this.streams.get(streamKey) || [];
    
    if (currentOffset >= stream.length) {
      const waitTime = parseInt(blockTimeout, 10) || 1000;
      await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 1000)));
      return null;
    }
    
    const countVal = parseInt(count, 10) || 10;
    const messagesToRead = stream.slice(currentOffset, currentOffset + countVal);
    this.streamOffsets.set(offsetKey, currentOffset + messagesToRead.length);
    
    const formattedMessages = messagesToRead.map(m => [m.id, m.fields]);
    return [[streamKey, formattedMessages]];
  }

  async xack(key, group, id) {
    return 1;
  }

  async xautoclaim(key, group, consumer, idle, start, countWord, count) {
    return ['0-0', []];
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
    const uppercaseArgs = args.map(a => String(a).toUpperCase());
    
    const hasNX = uppercaseArgs.includes('NX');
    const hasXX = uppercaseArgs.includes('XX');
    
    const exists = this.store.has(key) && !this._isExpired(key);
    
    if (hasNX && exists) {
      return null;
    }
    if (hasXX && !exists) {
      return null;
    }
    
    this.store.set(key, String(value));
    
    // Parse EX
    const exIndex = uppercaseArgs.indexOf('EX');
    if (exIndex !== -1 && exIndex + 1 < args.length) {
      const seconds = parseInt(args[exIndex + 1], 10);
      if (!isNaN(seconds)) {
        this.expirations.set(key, Date.now() + seconds * 1000);
      }
    }
    
    // Parse PX
    const pxIndex = uppercaseArgs.indexOf('PX');
    if (pxIndex !== -1 && pxIndex + 1 < args.length) {
      const ms = parseInt(args[pxIndex + 1], 10);
      if (!isNaN(ms)) {
        this.expirations.set(key, Date.now() + ms);
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

  async ttl(key) {
    if (!this.store.has(key)) return -2;
    const expiresAt = this.expirations.get(key);
    if (!expiresAt) return -1;
    const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
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

// 1️⃣ Cache Connection (أعلى أولوية - يفشل بسرعة للـ Fallback)
const cache = new Redis({
  ...baseConfig,
  db: 0,
  connectionName: 'cache',
  maxRetriesPerRequest: 2,
  commandTimeout: 500,
  retryStrategy: createRetryStrategy('Cache'),
});

// 2️⃣ BullMQ Connection (بدون timeout - مناسب للأمور المعلقة)
const bullmq = new Redis({
  ...baseConfig,
  db: 0,
  connectionName: 'bullmq',
  maxRetriesPerRequest: null,
  retryStrategy: createRetryStrategy('BullMQ'),
});

// 3️⃣ Pub/Sub Connection (blocking commands - Pub/Sub)
const pubsub = new Redis({
  ...baseConfig,
  db: 0,
  connectionName: 'pubsub',
  maxRetriesPerRequest: null,
  retryStrategy: createRetryStrategy('PubSub'),
});

const clients = [cache, bullmq, pubsub];
const labels = ['Cache', 'BullMQ', 'PubSub'];

clients.forEach((client, index) => {
  client.on('connect', () => {
    logger.info(`Redis [${labels[index]}] connected successfully to DB ${client.options.db}`);
  });

  client.on('error', (err) => {
    logger.error(`Redis [${labels[index]}] connection error`, { error: err.message });
  });
});

const createSubscriber = () => {
  const sub = new Redis({
    ...baseConfig,
    db: 0,
    connectionName: 'pubsub_sub_custom',
    enableReadyCheck: false,
    retryStrategy: (times) => times > 3 ? null : Math.min(times * 200, 3000),
  });
  sub.on('error', (err) => {
    logger.warn('[Redis:Sub] Subscription client connection error', { error: err.message });
  });
  return sub;
};

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

function configureDuplicate(client, label) {
  const originalDuplicate = client.duplicate.bind(client);
  client.duplicate = function(overrideOptions) {
    const duplicatedClient = originalDuplicate({ commandTimeout: undefined, ...overrideOptions });
    duplicatedClient.on('error', (err) => {
      logger.warn(`[Redis:${label}:Duplicated] Suppressed connection error: ${err.message}`);
    });
    return duplicatedClient;
  };
}

configureDuplicate(cache, 'Cache');
configureDuplicate(bullmq, 'BullMQ');
configureDuplicate(pubsub, 'PubSub');

// 🛰️ Hybrid Resilient Redis Export
const resilientCache = makeResilient(cache, 'Cache');
const resilientBullMQ = makeResilient(bullmq, 'BullMQ');
const resilientPubSub = makeResilient(pubsub, 'PubSub');

// التوافق الرجعي
resilientCache.redisCache = resilientCache;
resilientCache.redisBullMQ = resilientBullMQ;
resilientCache.redisPubSub = resilientPubSub;
resilientCache.redis = resilientCache;

// دوال الـ Pub/Sub للموديلات الأخرى
resilientCache.cache = resilientCache;
resilientCache.publisher = resilientCache;
resilientCache.subscriber = resilientPubSub;
resilientCache.socketSubscriber = resilientPubSub;
resilientCache.createSubscriber = () => makeResilient(createSubscriber(), 'Sub');
resilientCache.makeResilient = makeResilient;
resilientCache.getRedis = () => resilientCache;

// Health Check
resilientCache.checkRedisHealth = async function() {
  const results = await Promise.allSettled([
    cache.ping(),
    bullmq.ping(),
    pubsub.ping(),
  ]);
  return {
    cache: results[0].status === 'fulfilled',
    bullmq: results[1].status === 'fulfilled',
    pubsub: results[2].status === 'fulfilled',
  };
};

// الإغلاق المركزي النظيف
resilientCache.quitAll = async function() {
  await Promise.allSettled([
    cache.quit(),
    bullmq.quit(),
    pubsub.quit()
  ]);
  logger.info('🔌 [Redis] All isolated connections quit safely.');
};

module.exports = resilientCache;
