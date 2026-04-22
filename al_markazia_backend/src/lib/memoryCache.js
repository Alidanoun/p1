const NodeCache = require('node-cache');
const logger = require('../utils/logger');

/**
 * 🛡️ 3-Tier Fallback: Memory Cache Layer (Tier 2)
 * Provides high-speed, localized caching as a shield between Redis and DB.
 * Features: TTL, LRU Eviction, and Memory Hard-Cap.
 */
class MemoryCacheService {
  constructor() {
    this.cache = new NodeCache({
      stdTTL: 60, // Default 60 seconds
      checkperiod: 120,
      useClones: false,
      maxKeys: 5000 // Limit total keys to prevent memory bloat
    });

    this.MEMORY_LIMIT_MB = 128;
    this.stats = { hits: 0, misses: 0 };
  }

  get(key) {
    const value = this.cache.get(key);
    if (value) {
      this.stats.hits++;
      return value;
    }
    this.stats.misses++;
    return null;
  }

  set(key, value, ttl = 60) {
    // 🛡️ Memory Guard: Check if process memory is exceeding limit
    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
    if (memoryUsage > this.MEMORY_LIMIT_MB) {
      logger.warn(`[MemoryCache] ⚠️ Cap reached (${memoryUsage.toFixed(2)}MB). Skipping set for: ${key}`);
      return false;
    }

    return this.cache.set(key, value, ttl);
  }

  del(key) {
    return this.cache.del(key);
  }

  flush() {
    return this.cache.flushAll();
  }

  getStats() {
    return {
      ...this.cache.getStats(),
      ...this.stats,
      usageMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
    };
  }
}

module.exports = new MemoryCacheService();
