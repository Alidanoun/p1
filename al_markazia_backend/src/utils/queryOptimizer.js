/**
 * 🚀 Query Optimizer — N+1 Prevention Layer
 * Purpose: Replaces Prisma's nested `include` with batch-loading for list queries.
 * This reduces hundreds of SQL queries down to exactly 5, regardless of list size.
 *
 * Strategy:
 *   - Lists  → Batch Loading (this module)
 *   - Single → Direct Include (ORDER_INCLUDE_FULL, unchanged)
 *
 * 🛡️ Output shape is 100% compatible with mapOrderResponse() — no mapper changes needed.
 *
 * Safety:
 *   - MAX_BATCH_SIZE guard prevents memory explosion on large exports
 *   - Redis image cache eliminates redundant item image lookups
 */

const prisma = require('../lib/prisma');
const logger = require('./logger');

/** 🔴 Hard ceiling — prevents memory explosion from uncapped API calls */
const MAX_BATCH_SIZE = 200;

class QueryOptimizer {

  /**
   * ✅ Batch Loading Strategy (for order lists)
   * Fetches orders and all their relations in exactly 5 queries,
   * then assembles them in-memory to produce the same shape as Prisma `include`.
   *
   * @param {Object} where - Prisma where clause
   * @param {Object} orderBy - Prisma orderBy clause
   * @param {number} skip - Pagination offset
   * @param {number} take - Pagination limit (capped at MAX_BATCH_SIZE)
   * @returns {Array} Orders with customer, orderItems (with item.image), and cancellation
   */
  async fetchOrdersOptimized(where, orderBy, skip, take) {
    const startTime = Date.now();

    // 🔴 [GUARD] Clamp take to prevent memory explosion
    const safeTake = Math.min(take, MAX_BATCH_SIZE);

    try {
      // ── Query 1: Orders (flat, no relations) ──────────────────────────
      const orders = await prisma.order.findMany({
        where,
        orderBy,
        skip,
        take: safeTake,
      });

      if (orders.length === 0) {
        this._logPerformance('fetchOrdersOptimized', startTime, 0, 1);
        return [];
      }

      const orderIds = orders.map(o => o.id);
      const customerIds = [...new Set(orders.map(o => o.customerId).filter(Boolean))];

      // ── Query 2: Customers (single batch) ─────────────────────────────
      const customersMap = new Map();
      if (customerIds.length > 0) {
        const customers = await prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: {
            id: true,
            uuid: true,
            name: true,
            phone: true,
            fcmToken: true,
            isBlacklisted: true,
          },
        });
        customers.forEach(c => customersMap.set(c.id, c));
      }

      // ── Query 3: OrderItems (single batch, all orders) ────────────────
      const orderItems = await prisma.orderItem.findMany({
        where: { orderId: { in: orderIds } },
        orderBy: { id: 'asc' },
      });

      // ── Query 4: Item images (with Redis cache) ───────────────────────
      const itemIds = [...new Set(orderItems.map(oi => oi.itemId).filter(Boolean))];
      const itemImagesMap = await this._fetchItemImagesWithCache(itemIds);

      // ── Query 5: Cancellations (single batch) ────────────────────────
      const cancellations = await prisma.orderCancellation.findMany({
        where: { orderId: { in: orderIds } },
      });
      const cancellationsMap = new Map();
      cancellations.forEach(c => cancellationsMap.set(c.orderId, c));

      // ── Assembly: Group OrderItems by orderId ─────────────────────────
      const orderItemsMap = new Map();
      orderItems.forEach(oi => {
        if (!orderItemsMap.has(oi.orderId)) {
          orderItemsMap.set(oi.orderId, []);
        }
        // Attach nested item.image (mirrors Prisma include shape)
        oi.item = { image: itemImagesMap.get(oi.itemId) || null };
        orderItemsMap.get(oi.orderId).push(oi);
      });

      // ── Assembly: Merge everything into the order objects ─────────────
      const result = orders.map(order => ({
        ...order,
        customer: customersMap.get(order.customerId) || null,
        orderItems: orderItemsMap.get(order.id) || [],
        cancellation: cancellationsMap.get(order.id) || null,
      }));

      this._logPerformance('fetchOrdersOptimized', startTime, result.length, 5);
      return result;

    } catch (error) {
      logger.error('⚠️ [QueryOptimizer] fetchOrdersOptimized failed', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 🟢 Redis-cached item image resolver.
   * Item images rarely change, so we cache them for 5 minutes.
   * Falls back to a direct DB query if Redis is unavailable.
   *
   * @param {number[]} itemIds - Array of item IDs to resolve images for
   * @returns {Map<number, string|null>} Map of itemId → image path
   */
  async _fetchItemImagesWithCache(itemIds) {
    const imagesMap = new Map();
    if (itemIds.length === 0) return imagesMap;

    let redis;
    try {
      redis = require('../lib/redis');
    } catch {
      // Redis unavailable — fall through to DB
    }

    // ── Try Redis multi-get first ──────────────────────────────────────
    const uncachedIds = [];
    if (redis) {
      try {
        const cacheKeys = itemIds.map(id => `img:item:${id}`);
        const cached = await redis.mget(...cacheKeys);

        itemIds.forEach((id, idx) => {
          if (cached[idx] !== null) {
            imagesMap.set(id, cached[idx] === '__null__' ? null : cached[idx]);
          } else {
            uncachedIds.push(id);
          }
        });
      } catch {
        // Redis error — fetch everything from DB
        uncachedIds.push(...itemIds);
      }
    } else {
      uncachedIds.push(...itemIds);
    }

    // ── DB fetch for misses ────────────────────────────────────────────
    if (uncachedIds.length > 0) {
      const items = await prisma.item.findMany({
        where: { id: { in: uncachedIds } },
        select: { id: true, image: true },
      });

      // Populate map + write-back to Redis
      const pipeline = redis ? redis.pipeline() : null;
      items.forEach(i => {
        imagesMap.set(i.id, i.image);
        if (pipeline) {
          pipeline.setex(`img:item:${i.id}`, 300, i.image || '__null__');
        }
      });

      // Fill IDs that weren't found in DB (deleted items)
      uncachedIds.forEach(id => {
        if (!imagesMap.has(id)) {
          imagesMap.set(id, null);
          if (pipeline) pipeline.setex(`img:item:${id}`, 300, '__null__');
        }
      });

      if (pipeline) {
        pipeline.exec().catch(() => {}); // fire-and-forget
      }
    }

    return imagesMap;
  }

  /**
   * 📊 Performance logger — tracks duration and query count
   */
  _logPerformance(method, startTime, ordersCount, queriesUsed) {
    const duration = Date.now() - startTime;
    if (duration > 200) {
      logger.warn(`⚡ [QueryOptimizer] ${method}: ${duration}ms | ${ordersCount} orders | ${queriesUsed} queries`);
    } else {
      logger.debug(`⚡ [QueryOptimizer] ${method}: ${duration}ms | ${ordersCount} orders | ${queriesUsed} queries`);
    }
  }
}

module.exports = new QueryOptimizer();
