const redis = require('../lib/redis');
const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * ⚡ Menu Cache Service (Phase 2 Performance)
 * Handles write-through caching of the menu and ETag generation.
 */
class MenuCacheService {
  constructor() {
    this.BASE_KEY = 'menu:snapshot';
    this.ETAG_BASE = 'menu:etag';
    this.TTL = 3600; // 1 hour
  }

  _getCacheKey(branchId = 'global') {
    return `${this.BASE_KEY}:branch:${branchId}`;
  }

  _getETagKey(branchId = 'global') {
    return `${this.ETAG_BASE}:branch:${branchId}`;
  }

  /**
   * 💾 Set resolved menu snapshot in Redis per branch
   */
  async setMenu(menuData, branchId = 'global') {
    try {
      const data = JSON.stringify(menuData);
      const etag = crypto.createHash('md5').update(data).digest('hex');
      const cacheKey = this._getCacheKey(branchId);
      const etagKey = this._getETagKey(branchId);
      
      await redis.pipeline()
        .set(cacheKey, data, 'EX', this.TTL)
        .set(etagKey, etag, 'EX', this.TTL)
        .exec();
        
      logger.info('[MenuCache] Branch snapshot updated', { branchId, etag });
      return etag;
    } catch (err) {
      logger.error('[MenuCache] Failed to cache menu', { branchId, error: err.message });
      return null;
    }
  }

  /**
   * 🔍 Get resolved menu for a branch
   */
  async getMenu(branchId = 'global') {
    return await redis.get(this._getCacheKey(branchId));
  }

  /**
   * 🏷️ Get current ETag for a branch
   */
  async getETag(branchId = 'global') {
    return await redis.get(this._getETagKey(branchId));
  }

  /**
   * 🗑️ Invalidate Cache (supports global or branch-specific)
   */
  async invalidate(branchId = null) {
    try {
      if (branchId) {
        await redis.del(this._getCacheKey(branchId), this._getETagKey(branchId));
        logger.info('[MenuCache] Branch cache invalidated', { branchId });
      } else {
        // Global invalidation: find all keys and delete
        // Note: In high-scale, use SCAN. For now, simple DEL with wildcard if supported or manual.
        // Since we can't easily use wildcards in DEL, we'll delete the main ones
        const keys = await redis.keys(`${this.BASE_KEY}:*`);
        const etags = await redis.keys(`${this.ETAG_BASE}:*`);
        if (keys.length > 0) await redis.del(...keys);
        if (etags.length > 0) await redis.del(...etags);
        logger.info('[MenuCache] Global cache invalidated', { keysDeleted: keys.length + etags.length });
      }
    } catch (err) {
      logger.error('[MenuCache] Invalidation failed', { error: err.message });
    }
  }
}

module.exports = new MenuCacheService();
