const { DateTime } = require('luxon');
const { toNumber } = require('../utils/number');

/**
 * 📊 Analytics & Reporting Service
 */
class AnalyticsService {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
  }
  
  async getBranchOperationalReport(user, requestedBranchId) {
    if (!user) throw new Error('UNAUTHORIZED');

    const role = user.role?.toLowerCase();
    const isGlobalAdmin = role === 'admin';

    // 🛡️ [PHASE 4] Forced Isolation: Managers cannot see outside their branch
    const branchId = isGlobalAdmin ? requestedBranchId : user.branchId;

    if (!isGlobalAdmin && requestedBranchId && requestedBranchId !== user.branchId) {
      this.logger.security('UNAUTHORIZED_ANALYTICS_ATTEMPT', { userId: user.id, requestedBranchId, actualBranchId: user.branchId });
      throw new Error('ACCESS_DENIED: Unauthorized branch analytics');
    }

    const now = DateTime.now().setZone('Asia/Amman');
    const start = now.startOf('day').toJSDate();
    const end = now.endOf('day').toJSDate();

    const whereClause = {
      createdAt: { gte: start, lte: end },
      isDeleted: false
    };
    if (branchId) whereClause.branchId = branchId;

    const orders = await this.prisma.order.findMany({
      where: whereClause,
      select: {
        id: true,
        status: true,
        total: true,
        orderItems: { select: { itemName: true, quantity: true } }
      }
    });

    const metrics = {
      totalOrders: orders.length,
      activeOrders: orders.filter(o => ['pending', 'preparing', 'ready', 'confirmed', 'waiting_cancellation', 'waiting_cancellation_admin'].includes(o.status)).length,
      cancellations: orders.filter(o => o.status === 'cancelled').length,
      topItems: this._calculateTopItems(orders),
      revenue: orders.reduce((sum, o) => sum + toNumber(o.total), 0)
    };

    // 🛡️ [P10] Upsert to Server Driven State (Conditional for physical branch only)
    let version = 1;
    let eventSequence = 1;
    let updatedAt = new Date();

    if (branchId) {
      const branchMetric = await this.prisma.branchMetric.upsert({
        where: { branchId },
        update: {
          totalOrders: metrics.totalOrders,
          activeOrders: metrics.activeOrders,
          cancellations: metrics.cancellations,
          revenue: metrics.revenue,
          version: { increment: 1 },
          eventSequence: { increment: 1 }
        },
        create: {
          branchId,
          totalOrders: metrics.totalOrders,
          activeOrders: metrics.activeOrders,
          cancellations: metrics.cancellations,
          revenue: metrics.revenue
        }
      });

      version = branchMetric.version;
      eventSequence = branchMetric.eventSequence;
      updatedAt = branchMetric.updatedAt;
    }

    return {
      ...metrics,
      version,
      eventSequence,
      updatedAt
    };
  }

  _calculateTopItems(orders) {
    const itemCounts = {};
    orders.forEach(order => {
      order.orderItems.forEach(item => {
        const name = item.itemName;
        itemCounts[name] = (itemCounts[name] || 0) + item.quantity;
      });
    });
    return Object.entries(itemCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));
  }

  updateCacheIncrementally(data) { return true; }
}

// --- 🛡️ Backward Compatibility ---
const getContainer = () => require('../lib/container');
const proxy = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'AnalyticsService') return AnalyticsService;
    const service = getContainer().analyticsService;
    const val = service[prop];
    return typeof val === 'function' ? val.bind(service) : val;
  }
});

module.exports = proxy;
module.exports.AnalyticsService = AnalyticsService;
