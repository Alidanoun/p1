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
    
    // 1. Local Cache (L1)
    this.localCache = new NodeCache({ 
      stdTTL: 600,
      checkperiod: 120
    });

    // 🛡️ Circuit Breaker State
    this.circuitState = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.failureThreshold = 5;
    this.resetTimeout = 60000; // 60 seconds

    // 2. Redis Configuration
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      commandTimeout: 3000 // 🛡️ Fail fast
    };
    
    this.redis = new Redis(redisConfig);
    this.pubSub = new Redis({ ...redisConfig, enableReadyCheck: false });
    this.isSubscribed = false;

    this.setupPubSub();
    this.setupConfigs();
  }

  /**
   * 🛡️ Record a success to potentially close the circuit
   */
  recordSuccess() {
    this.failureCount = 0;
    if (this.circuitState === 'HALF_OPEN') {
      this.circuitState = 'CLOSED';
      logger.info('🟢 [CircuitBreaker] Redis connection recovered. Circuit CLOSED.');
    }
  }

  /**
   * 🛡️ Record a failure to potentially open the circuit
   */
  recordFailure(err) {
    this.failureCount++;
    if (this.circuitState === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      this.circuitState = 'OPEN';
      logger.error('🔴 [CircuitBreaker] Redis failures threshold reached. Circuit OPEN. Falling back to local cache.', { error: err.message });

      // Schedule a reset attempt
      setTimeout(() => {
        this.circuitState = 'HALF_OPEN';
        this.failureCount = 0;
        logger.warn('🟡 [CircuitBreaker] Reset timeout reached. Circuit HALF_OPEN. Attempting reconnection...');
      }, this.resetTimeout);
    }
  }

  /**
   * 🛡️ Check if we should allow Redis operations
   */
  canUseRedis() {
    return this.circuitState !== 'OPEN';
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
      if (!this.isSubscribed) this.subscribe();
    });

    this.pubSub.on('message', (channel, message) => {
      if (channel === 'cache:invalidate') {
        try {
          const { key, targetId, originInstance } = JSON.parse(message);
          if (originInstance === this.instanceId) return;
          this.clearLocal(key, targetId);
        } catch (e) {}
      }
    });
  }

  async subscribe() {
    try {
      await this.pubSub.subscribe('cache:invalidate');
      this.isSubscribed = true;
    } catch (err) {}
  }

  clearLocal(cacheKey, targetId = null) {
    const config = this.configs[cacheKey];
    if (!config) return;

    if (targetId) {
      this.localCache.del(`${config.prefix}${targetId}`);
    } else {
      const keys = this.localCache.keys();
      const targets = keys.filter(k => k.startsWith(config.prefix));
      this.localCache.del(targets);
    }
  }

  async broadcastInvalidation(cacheKey, targetId = null) {
    this.clearLocal(cacheKey, targetId);
    
    if (!this.canUseRedis()) return;

    try {
      const config = this.configs[cacheKey];
      if (config && targetId) {
        await this.redis.del(`${config.prefix}${targetId}`);
      }

      const message = JSON.stringify({
        key: cacheKey,
        targetId,
        originInstance: this.instanceId,
        timestamp: Date.now()
      });
      
      await this.redis.publish('cache:invalidate', message);
      this.recordSuccess();
    } catch (err) {
      this.recordFailure(err);
    }
  }

  async get(cacheKey, id) {
    const config = this.configs[cacheKey];
    if (!config) return null;

    const key = `${config.prefix}${id}`;

    // L1 Check
    const local = this.localCache.get(key);
    if (local) return local;

    // L2 Check (Protected by Circuit Breaker)
    if (!this.canUseRedis()) return null;

    try {
      const remote = await this.redis.get(key);
      if (remote) {
        const data = JSON.parse(remote);
        this.localCache.set(key, data, config.ttl);
        this.recordSuccess();
        return data;
      }
      this.recordSuccess();
    } catch (err) {
      this.recordFailure(err);
    }

    return null;
  }

  async set(cacheKey, id, data, customTTL = null) {
    const config = this.configs[cacheKey];
    if (!config) return;

    const key = `${config.prefix}${id}`;
    const ttl = customTTL || config.ttl;

    this.localCache.set(key, data, ttl);

    if (!this.canUseRedis()) return;

    try {
      await this.redis.setex(key, ttl, JSON.stringify(data));
      this.recordSuccess();
    } catch (err) {
      this.recordFailure(err);
    }
  }

  async destroy() {
    try {
      this.localCache.flushAll();
      await this.redis.quit();
      await this.pubSub.quit();
    } catch (err) {}
  }

  async getStats() {
    try {
      const redisKeys = this.canUseRedis() ? await this.redis.dbsize() : 'N/A (Circuit Open)';
      return {
        instanceId: this.instanceId,
        circuitState: this.circuitState,
        redisKeys,
        localKeys: this.localCache.keys().length,
        isSubscribed: this.isSubscribed
      };
    } catch (err) {
      return { circuitState: this.circuitState, localKeys: this.localCache.keys().length };
    }
  }
}

module.exports = new CacheService();

module.exports = new CacheService();
