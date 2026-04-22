const prisma = require('../lib/prisma');
const redis = require('../lib/redis');
const socketIo = require('../socket');
const logger = require('../utils/logger');
const { toNumber, toMoney } = require('../utils/number');
const { SOCKET_EVENTS, SOCKET_ROOMS } = require('../shared/socketEvents');

let pending = false;
let lastSnapshot = null;

/**
 * 🧠 Live Analytics Engine (Command Center Core)
 * Features: Debounced calculation, UTC-safe metrics, multi-tier revenue, and item rankings.
 */
class AnalyticsService {
  /**
   * 🧠 Safe JSON Parser
   * Handles string vs object data from DB gracefully.
   */
  _safeParse(data) {
    try {
      if (!data) return null;
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
      return null;
    }
  }

  /**
   * ⚡ Debounced Scheduler
   * Prevents DB bottleneck by batching updates (max once per second)
   */
  scheduleUpdate() {
    if (pending) return;

    pending = true;

    // Wait for the "storm" to settle or batch rapid events
    setTimeout(async () => {
      try {
        await this.syncWithDatabase();
      } catch (err) {
        logger.error('Analytics broadcast failed', { error: err.message });
      } finally {
        pending = false;
      }
    }, 1000);
  }

  /**
   * 🔄 Deep Sync (Reconciliation Layer)
   * Fetches absolute truth from DB and updates the cache.
   */
  async syncWithDatabase() {
    try {
      const metrics = await this.getAllMetrics();
      
      // 🛡️ GLOBAL SEQUENCE (Source of Truth)
      const sequence = await redis.incr('analytics:sequence');
      metrics.sequence = sequence;
      
      lastSnapshot = metrics;

      const io = socketIo.getIO();
      if (io) {
        io.to(SOCKET_ROOMS.ADMIN).emit(SOCKET_EVENTS.DASHBOARD_METRICS, metrics);
      }
      return metrics;
    } catch (err) {
      logger.error('Deep Sync failed', { error: err.message });
      throw err;
    }
  }

  /**
   * 🔥 Optimistic Incremental Update
   * Updates memory cache immediately for instant UI feedback without DB hit.
   */
  async updateCacheIncrementally(event) {
    if (!lastSnapshot) {
      // If no cache, trigger a full sync first
      return this.scheduleUpdate();
    }

    const { type, amount, status, previousStatus, orderNumber, action } = event;

    // Helper to identify statuses that contribute to live revenue (Confirmed+)
    const isRevenueStatus = (s) => ['confirmed', 'preparing', 'ready', 'in_route', 'delivered'].includes(s);

    // 1. Update Revenue & Counts
    if (type === 'ORDER_CREATED') {
      lastSnapshot.revenue.orderCount += 1;
      // Note: Don't add to live revenue for pending orders (matches deep sync)
      lastSnapshot.statusDistribution['pending'] = (lastSnapshot.statusDistribution['pending'] || 0) + 1;
    } 
    else if (type === 'ORDER_STATUS_CHANGE') {
      // Update distribution
      if (previousStatus && lastSnapshot.statusDistribution[previousStatus] > 0) {
        lastSnapshot.statusDistribution[previousStatus] -= 1;
      }
      lastSnapshot.statusDistribution[status] = (lastSnapshot.statusDistribution[status] || 0) + 1;

      // 🛡️ BUG-008: Robust Revenue Transition Logic
      const wasRevenue = isRevenueStatus(previousStatus);
      const isRevenue = isRevenueStatus(status);

      if (!wasRevenue && isRevenue) {
        // Just entered revenue stream (e.g. pending -> confirmed)
        lastSnapshot.revenue.live += toNumber(amount);
        lastSnapshot.revenue.liveOrderCount = (lastSnapshot.revenue.liveOrderCount || 0) + 1;
      }
      else if (wasRevenue && !isRevenue) {
        // Left revenue stream (e.g. confirmed -> cancelled)
        lastSnapshot.revenue.live -= toNumber(amount);
        lastSnapshot.revenue.liveOrderCount = Math.max(0, (lastSnapshot.revenue.liveOrderCount || 0) - 1);
      }

      // Update Real Revenue if delivered (Final finalized money)
      if (status === 'delivered') {
        lastSnapshot.revenue.real += toNumber(amount);
      }
    }

    // 2. Optimistic Activity Feed Injection
    if (orderNumber && action) {
      const newActivity = {
        id: `opt-${Date.now()}`,
        orderNumber,
        action,
        status: status || 'unknown',
        time: new Date(),
        user: event.user || 'System',
        timestamp: Date.now()
      };
      
      lastSnapshot.activityFeed = [newActivity, ...lastSnapshot.activityFeed.slice(0, 14)];
    }

    lastSnapshot.lastUpdated = new Date();
    
    // Broadcast optimistic result immediately
    const io = socketIo.getIO();
    if (io) {
      io.to(SOCKET_ROOMS.ADMIN).emit(SOCKET_EVENTS.DASHBOARD_METRICS, lastSnapshot);
    }

    // Still schedule a debounced DB sync to ensure consistency (Safe Approach)
    this.scheduleUpdate();
  }

  /**
   * 📊 Heavy Lifting: Combined Data Aggregation
   */
  async getAllMetrics() {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const [todayOrders, topItemsData, recentLogs, topZonesData] = await Promise.all([
      // 1. Fetch Today's Orders for Revenue & Status
      prisma.order.findMany({
        where: { createdAt: { gte: todayStart } },
        select: { 
          subtotal: true,
          discount: true,
          total: true, 
          status: true, 
          orderNumber: true, 
          customerName: true,
          createdAt: true,
          orderType: true,
          deliveryZoneName: true,
          deliveryFee: true
        }
      }),

      // 2. Aggregate Top Items (Quantity & Revenue)
      prisma.orderItem.groupBy({
        by: ['itemId', 'itemName'],
        where: { order: { createdAt: { gte: todayStart }, status: { in: ['confirmed', 'preparing', 'ready', 'in_route', 'delivered'] } } },
        _sum: {
          quantity: true,
          lineTotal: true
        },
        orderBy: {
          _sum: {
            quantity: 'desc'
          }
        },
        take: 10
      }),

      // 3. Activity Feed (Last 15 relevant events)
      prisma.orderAuditLog.findMany({
        take: 15,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          orderId: true,
          order: { select: { orderNumber: true } },
          previousData: true,
          newData: true,
          eventAction: true,
          createdAt: true,
          changedBy: true
        }
      }),

      // 4. TOP ZONES (Revenue distribution by Zone)
      prisma.order.groupBy({
        by: ['deliveryZoneName'],
        where: { createdAt: { gte: todayStart }, status: { not: 'cancelled' }, orderType: 'delivery' },
        _sum: { 
          subtotal: true,
          discount: true,
          deliveryFee: true
        },
        _count: { id: true },
        orderBy: { _sum: { subtotal: 'desc' } },
        take: 5
      })
    ]);

    // 💰 Calculate Tiered Revenue (🛡️ BUG-005 Fix: Use order.total)
    const liveOrders = todayOrders.filter(o => ['confirmed', 'preparing', 'ready', 'in_route', 'delivered'].includes(o.status));
    const liveRevenue = liveOrders.reduce((acc, o) => acc + toNumber(o.total), 0);
    const liveOrderCount = liveOrders.length;

    const realRevenue = todayOrders
      .filter(o => o.status === 'delivered')
      .reduce((acc, o) => acc + toNumber(o.total), 0);

    const totalDeliveryFeeRevenue = todayOrders
      .filter(o => o.status !== 'cancelled')
      .reduce((acc, o) => acc + toNumber(o.deliveryFee), 0);

    // 📈 Distribution Logic
    const statusStats = todayOrders.reduce((acc, o) => {
      acc[o.status] = (acc[o.status] || 0) + 1;
      return acc;
    }, {});

    const typeStats = todayOrders.reduce((acc, o) => {
      acc[o.orderType] = (acc[o.orderType] || 0) + 1;
      return acc;
    }, { delivery: 0, takeaway: 0, dine_in: 0 });

    const foodRevenueBreakdown = todayOrders
      .filter(o => o.status !== 'cancelled')
      .reduce((acc, o) => acc + toMoney(toNumber(o.subtotal) - toNumber(o.discount)), 0);

    const deliveryRevenueBreakdown = todayOrders
      .filter(o => o.orderType === 'delivery' && o.status !== 'cancelled')
      .reduce((acc, o) => acc + toMoney(toNumber(o.subtotal) - toNumber(o.discount)), 0);

    const takeawayRevenueBreakdown = todayOrders
      .filter(o => o.orderType !== 'delivery' && o.status !== 'cancelled')
      .reduce((acc, o) => acc + toMoney(toNumber(o.subtotal) - toNumber(o.discount)), 0);

    return {
      revenue: {
        live: liveRevenue,
        real: realRevenue,
        orderCount: todayOrders.length,
        liveOrderCount: liveOrderCount,
        delivery: deliveryRevenueBreakdown,
        takeaway: takeawayRevenueBreakdown,
        deliveryFees: totalDeliveryFeeRevenue
      },
      statusDistribution: statusStats,
      typeDistribution: typeStats,
      topItems: topItemsData.map(item => ({
        itemId: item.itemId,
        name: item.itemName,
        quantity: item._sum.quantity,
        revenue: toNumber(item._sum.lineTotal)
      })),
      topZones: topZonesData.map(zone => ({
        name: zone.deliveryZoneName || 'غير محدد',
        count: zone._count.id,
        revenue: toMoney(toNumber(zone._sum.subtotal) - toNumber(zone._sum.discount)),
        deliveryFees: toNumber(zone._sum.deliveryFee)
      })),
      activityFeed: recentLogs.map(log => {
        const newData = this._safeParse(log.newData);
        
        // 🛡️ Hardening: Log if payload is missing
        if (!log.newData && !log.previousData) {
          logger.warn('[Analytics] Missing JSON payload in audit log', { logId: log.id, orderId: log.orderId });
        }

        return {
          id: log.id,
          orderNumber: log.order?.orderNumber,
          action: log.eventAction,
          status: newData?.status || 'unknown',
          time: log.createdAt,
          user: log.changedBy || 'System',
          timestamp: new Date(log.createdAt).getTime() // For Delta Sync
        };
      }),
      lastUpdated: new Date(),
      sequence: 0 // Will be overwritten by scheduler/snapshot
    };
  }

  /**
   * Get Cached Snapshot (for initial page load)
   */
  async getSnapshot() {
    if (!lastSnapshot) {
      lastSnapshot = await this.getAllMetrics();
    }
    return lastSnapshot;
  }

  /**
   * 🛡️ Maintenance: Start Deep Sync Loop
   */
  startReconciliationLoop() {
    // Perform a full DB consistency check every 60 seconds
    setInterval(() => {
      logger.info('[Analytics] Periodic Deep Sync triggered');
      this.syncWithDatabase().catch(() => {});
    }, 60000);
  }
}

const service = new AnalyticsService();
service.startReconciliationLoop(); // Start deep sync background worker

module.exports = service;
