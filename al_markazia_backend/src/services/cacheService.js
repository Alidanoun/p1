const Redis = require('ioredis');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

/**
 * 🎯 Centralized Cache Service (Singleton)
 * Implements Multi-Instance Invalidation via Redis Pub/Sub.
 * Uses a two-tier strategy: Local NodeCache (Fast) + Shared Redis (Distributed).
 */
class CacheService {
  constructor() {
    this.instanceId = process.env.INSTANCE_ID || `inst-${Math.random().toString(36).substr(2, 5)}`;
    
    // 1. Local Cache (L1) - Extremely fast but instance-local
    this.localCache = new NodeCache({ 
      stdTTL: 600,       // 10 minutes default
      checkperiod: 120   // Cleanup every 2 mins
    });

    // 2. Main Redis Connection (L2) - Shared across all instances
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      retryStrategy: (times) => Math.min(times * 50, 2000)
    };
    
    this.redis = new Redis(redisConfig);

    // 3. Pub/Sub Channel for Invalidation (L3)
    this.pubSub = new Redis({
      ...redisConfig,
      enableReadyCheck: false,
      maxRetriesPerRequest: null
    });
    this.isSubscribed = false;

    this.setupPubSub();
    this.setupConfigs();
  }

  setupConfigs() {
    this.configs = {
      'restaurant_status': { ttl: 300, prefix: 'status:' },
      'restaurant_menu': { ttl: 3600, prefix: 'menu:' },
      'dashboard_stats': { ttl: 300, prefix: 'stats:' },
      'system_settings': { ttl: 1800, prefix: 'settings:' }
    };
  }

  setupPubSub() {
    this.pubSub.on('connect', () => {
      logger.info(`📡 [CachePubSub] Connected from instance ${this.instanceId}`);
      if (!this.isSubscribed) {
        this.subscribe();
      }
    });

    this.pubSub.on('message', (channel, message) => {
      if (channel === 'cache:invalidate') {
        const { key, targetId, originInstance } = JSON.parse(message);
        
        // Skip if we originated the message (already handled locally)
        if (originInstance === this.instanceId) return;

        logger.info(`🔄 [CacheSync] Invalidation received for ${key}:${targetId || '*'}`);
        this.clearLocal(key, targetId);
      }
    });

    this.pubSub.on('error', (err) => logger.error('[CachePubSub] Connection error', { error: err.message }));
  }

  async subscribe() {
    try {
      await this.pubSub.subscribe('cache:invalidate');
      this.isSubscribed = true;
    } catch (err) {
      logger.error('[CachePubSub] Subscription failed', { error: err.message });
    }
  }

  /**
   * 🗑️ Clear Local Cache only
   */
  clearLocal(cacheKey, targetId = null) {
    const config = this.configs[cacheKey];
    if (!config) return;

    if (targetId) {
      this.localCache.del(`${config.prefix}${targetId}`);
    } else {
      // If no ID, clear all keys starting with this prefix
      const keys = this.localCache.keys();
      const targets = keys.filter(k => k.startsWith(config.prefix));
      this.localCache.del(targets);
    }
  }

  /**
   * 📡 Broadcast Invalidation to all instances
   */
  async broadcastInvalidation(cacheKey, targetId = null) {
    try {
      // 1. Clear local cache first
      this.clearLocal(cacheKey, targetId);

      // 2. Clear Shared Redis Cache
      const config = this.configs[cacheKey];
      if (config) {
        const redisKey = targetId ? `${config.prefix}${targetId}` : null;
        if (redisKey) {
          await this.redis.del(redisKey);
        } else {
          // Dangerous operation: clearing prefix in Redis (needs SCAN)
          // For simplicity in this env, we assume targetId is usually provided for mutations
        }
      }

      // 3. Notify other instances
      const message = JSON.stringify({
        key: cacheKey,
        targetId,
        originInstance: this.instanceId,
        timestamp: Date.now()
      });
      
      await this.redis.publish('cache:invalidate', message);
      logger.info(`📡 [CacheBroadcast] Invalidation sent for ${cacheKey}`);
    } catch (err) {
      logger.error('[CacheBroadcast] Failed', { error: err.message });
    }
  }

  /**
   * 📖 Get from Cache (Tiered)
   */
  async get(cacheKey, id) {
    const config = this.configs[cacheKey];
    if (!config) return null;

    const key = `${config.prefix}${id}`;

    // 1. Check L1 (Local)
    const local = this.localCache.get(key);
    if (local) return local;

    // 2. Check L2 (Redis)
    try {
      const remote = await this.redis.get(key);
      if (remote) {
        const data = JSON.parse(remote);
        // Backfill L1
        this.localCache.set(key, data, config.ttl);
        return data;
      }
    } catch (err) {
      logger.error('[CacheRead] Redis error', { error: err.message });
    }

    return null;
  }

  /**
   * 💾 Set Cache (Tiered)
   */
  async set(cacheKey, id, data, customTTL = null) {
    const config = this.configs[cacheKey];
    if (!config) return;

    const key = `${config.prefix}${id}`;
    const ttl = customTTL || config.ttl;

    // 1. Set L1
    this.localCache.set(key, data, ttl);

    // 2. Set L2
    try {
      await this.redis.setex(key, ttl, JSON.stringify(data));
    } catch (err) {
      logger.error('[CacheWrite] Redis error', { error: err.message });
    }
  }

  /**
   * 🧹 Graceful Shutdown
   */
  async destroy() {
    try {
      this.localCache.flushAll();
      await this.redis.quit();
      await this.pubSub.quit();
      logger.info('✅ Cache Service destroyed gracefully.');
    } catch (err) {
      logger.error('[CacheDestroy] Failed', { error: err.message });
    }
  }

  /**
   * 📊 Get Cache Health Stats
   */
  async getStats() {
    try {
      const keys = await this.redis.dbsize();
      const localKeys = this.localCache.keys().length;
      return {
        instanceId: this.instanceId,
        redisKeys: keys,
        localKeys: localKeys,
        isSubscribed: this.isSubscribed,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      logger.error('[CacheStats] Failed', { error: err.message });
      return null;
    }
  }
}

module.exports = new CacheService();
