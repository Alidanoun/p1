const redis = require('../lib/redis');
const logger = require('../utils/logger');

/**
 * ⚡ Live Orders Cache Service (Phase 2 Performance)
 * Maintains a high-speed snapshot of active orders in Redis.
 * Offloads PostgreSQL by serving real-time queries from cache.
 */
class LiveCacheService {
  constructor() {
    this.PREFIX = 'live:order:';
    this.ACTIVE_POOL_KEY = 'live:orders:active_ids';
    this.TTL = 3600; // 1 hour (orders usually complete within this)
  }

  /**
   * 💾 Sync order to Redis
   */
  async cacheOrder(order) {
    try {
      const key = `${this.PREFIX}${order.id}`;
      const data = JSON.stringify(order);
      
      await redis.pipeline()
        .set(key, data, 'EX', this.TTL)
        .sadd(this.ACTIVE_POOL_KEY, order.id.toString())
        .exec();
        
      return true;
    } catch (err) {
      logger.error('[LiveCache] Failed to cache order', { orderId: order.id, error: err.message });
      return false;
    }
  }

  /**
   * 🗑️ Remove order from active cache (on completion/cancellation)
   */
  async uncacheOrder(orderId) {
    try {
      await redis.pipeline()
        .del(`${this.PREFIX}${orderId}`)
        .srem(this.ACTIVE_POOL_KEY, orderId.toString())
        .exec();
      return true;
    } catch (err) {
      logger.error('[LiveCache] Failed to uncache order', { orderId, error: err.message });
      return false;
    }
  }

  /**
   * 🔍 Get cached order
   */
  async getOrder(orderId) {
    const data = await redis.get(`${this.PREFIX}${orderId}`);
    return data ? JSON.parse(data) : null;
  }

  /**
   * 📊 Get all active orders for a branch (High performance)
   */
  async getActiveOrders(branchId = null) {
    const ids = await redis.smembers(this.ACTIVE_POOL_KEY);
    if (!ids.length) return [];

    const keys = ids.map(id => `${this.PREFIX}${id}`);
    const results = await redis.mget(keys);
    
    let orders = results
      .filter(r => r !== null)
      .map(r => JSON.parse(r));

    if (branchId) {
      orders = orders.filter(o => o.branchId === branchId);
    }

    return orders;
  }
}

module.exports = new LiveCacheService();
