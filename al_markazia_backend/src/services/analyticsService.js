const { DateTime } = require('luxon');
const { toNumber } = require('../utils/number');
const { DEFAULT_TIMEZONE } = require('../config/constants');

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
    const branchId = isGlobalAdmin ? requestedBranchId : user.branchId;

    if (!isGlobalAdmin && requestedBranchId && requestedBranchId !== user.branchId) {
      this.logger.security('UNAUTHORIZED_ANALYTICS_ATTEMPT', { userId: user.id, requestedBranchId, actualBranchId: user.branchId });
      throw new Error('ACCESS_DENIED: Unauthorized branch analytics');
    }

    let tz = DEFAULT_TIMEZONE;
    if (branchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: branchId },
        select: { timezone: true }
      });
      if (branch?.timezone) tz = branch.timezone;
    }

    const now = DateTime.now().setZone(tz);
    const start = now.startOf('day').toJSDate();
    const end = now.endOf('day').toJSDate();

    // 1. 🛡️ Delegate to Advanced Financial Aggregator (Step 2 Optimization)
    const financialMetrics = await this.container.financialAggregatorService.aggregateBranchData(
      branchId, 
      start, 
      end
    );

    // 3. Fetch Operational Stats (Status Distribution)
    const statusGroups = await this.prisma.order.groupBy({
      by: ['status'],
      where: {
        createdAt: { gte: start, lte: end },
        branchId: branchId || undefined,
        isDeleted: false
      },
      _count: { id: true }
    });

    const statusMap = statusGroups.reduce((acc, g) => ({ ...acc, [g.status]: g._count.id }), {});
    const activeOrders = ['pending', 'preparing', 'ready', 'confirmed', 'waiting_cancellation', 'waiting_cancellation_admin']
      .reduce((sum, s) => sum + (statusMap[s] || 0), 0);

    // 4. Fetch Top Items (Non-financial, O(n) is acceptable for small subset)
    const topItemsData = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        branchId: branchId || undefined,
        isDeleted: false
      },
      select: { orderItems: { select: { itemName: true, quantity: true } } }
    });

    const metrics = {
      totalOrders: financialMetrics.orderCount,
      activeOrders,
      cancellations: statusMap['cancelled'] || 0,
      topItems: await this._calculateTopItems(start, end, branchId),
      revenue: financialMetrics.netRevenue, // Report net realized income
      grossRevenue: financialMetrics.grossRevenue,
      baseRevenue: financialMetrics.baseRevenue,
      totalRefunds: financialMetrics.totalRefunds,
      taxLiability: financialMetrics.taxTotal,
      deliveryFees: financialMetrics.deliveryTotal
    };

    // 🛡️ [P10] Persistence into Metric Store (Async safe-guard)
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

  async _calculateTopItems(start, end, branchId) {
    const topItems = await this.prisma.orderItem.groupBy({
      by: ['itemName'],
      where: {
        order: {
          createdAt: { gte: start, lte: end },
          branchId: branchId || undefined,
          isDeleted: false
        }
      },
      _sum: { quantity: true },
      orderBy: {
        _sum: { quantity: 'desc' }
      },
      take: 5
    });

    return topItems.map(item => ({
      name: item.itemName,
      count: item._sum.quantity
    }));
  }

  async getDashboardMetrics(user, period = 'today') {
    if (!user) throw new Error('UNAUTHORIZED');

    const targetBranchId = user.role === 'admin' ? null : user.branchId;
    let tz = DEFAULT_TIMEZONE;
    if (targetBranchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: targetBranchId },
        select: { timezone: true }
      });
      if (branch?.timezone) tz = branch.timezone;
    }
    const now = DateTime.now().setZone(tz);
    let start, end;

    if (period === 'today') {
      start = now.startOf('day').toJSDate();
      end = now.endOf('day').toJSDate();
    } else if (period === 'week') {
      start = now.minus({ days: 7 }).startOf('day').toJSDate();
      end = now.endOf('day').toJSDate();
    } else if (period === 'month') {
      start = now.minus({ months: 1 }).startOf('day').toJSDate();
      end = now.endOf('day').toJSDate();
    } else {
      start = now.startOf('day').toJSDate();
      end = now.endOf('day').toJSDate();
    }

    // 1. 🛡️ Advanced Aggregation (Step 2 - DB Native)
    const metrics = await this.container.financialAggregatorService.aggregateBranchData(
      targetBranchId,
      start,
      end
    );

    // 2. Fetch Chart Data (Status Timeline)
    // For Dashboard, we usually want Order Count trend
    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        branchId: targetBranchId || undefined,
        isDeleted: false
      },
      select: { createdAt: true, status: true },
      orderBy: { createdAt: 'asc' }
    });

    const chartMap = {};
    const chartMapOrder = []; // to preserve chronological order
    orders.forEach(o => {
      const dt = DateTime.fromJSDate(o.createdAt).setZone(tz);
      let label;
      if (period === 'today') {
        label = dt.toFormat('hh:00 a', { locale: 'ar-EG' });
      } else if (period === 'week') {
        label = dt.toFormat('cccc (dd/MM)', { locale: 'ar-EG' });
      } else {
        label = dt.toFormat('dd LLLL', { locale: 'ar-EG' });
      }
      
      if (!chartMap[label]) {
        chartMap[label] = 0;
        chartMapOrder.push(label);
      }
      chartMap[label]++;
    });

    const chartData = chartMapOrder.map(label => ({ label, count: chartMap[label] }));

    // 3. Fetch Top Items (Optimization: Only if items exist)
    const topItemsData = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        branchId: targetBranchId || undefined,
        isDeleted: false
      },
      select: { orderItems: { select: { itemName: true, quantity: true } } },
      take: 500 // Limit for safety
    });

    return {
      overview: {
        totalRevenue: metrics.netRevenue,
        totalOrders: metrics.orderCount,
        avgOrderValue: metrics.orderCount > 0 ? (metrics.netRevenue / metrics.orderCount) : 0,
        grossRevenue: metrics.grossRevenue,
        baseRevenue: metrics.baseRevenue,
        totalRefunds: metrics.totalRefunds,
        totalDiscounts: metrics.totalDiscounts,
        taxLiability: metrics.taxTotal,
        deliveryFees: metrics.deliveryTotal
      },
      chartData,
      topItems: await this._calculateTopItems(start, end, targetBranchId)
    };
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
