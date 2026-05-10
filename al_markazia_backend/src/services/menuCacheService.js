const redis = require('../lib/redis');
const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * ⚡ Menu Cache Service (Phase 2 Performance)
 * Handles write-through caching of the menu and ETag generation.
 */
class MenuCacheService {
  constructor() {
    this.CACHE_KEY = 'menu:snapshot:full';
    this.ETAG_KEY = 'menu:etag';
    this.TTL = 86400; // 24 hours
  }

  /**
   * 💾 Set menu snapshot in Redis
   */
  async setMenu(menuData) {
    try {
      const data = JSON.stringify(menuData);
      const etag = crypto.createHash('md5').update(data).digest('hex');
      
      await redis.pipeline()
        .set(this.CACHE_KEY, data, 'EX', this.TTL)
        .set(this.ETAG_KEY, etag, 'EX', this.TTL)
        .exec();
        
      logger.info('[MenuCache] Snapshot updated', { etag });
      return etag;
    } catch (err) {
      logger.error('[MenuCache] Failed to cache menu', { error: err.message });
      return null;
    }
  }

  /**
   * 🔍 Get cached menu
   */
  async getMenu() {
    return await redis.get(this.CACHE_KEY);
  }

  /**
   * 🏷️ Get current ETag
   */
  async getETag() {
    return await redis.get(this.ETAG_KEY);
  }

  /**
   * 🗑️ Invalidate Cache
   */
  async invalidate() {
    await redis.del(this.CACHE_KEY, this.ETAG_KEY);
    logger.info('[MenuCache] Cache invalidated');
  }
}

module.exports = new MenuCacheService();
