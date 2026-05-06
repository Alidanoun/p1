const { DateTime } = require('luxon');

/**
 * 📊 Analytics & Reporting Service
 */
class AnalyticsService {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
  }
  
  async getBranchOperationalReport(branchId) {
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

    return {
      totalOrders: orders.length,
      activeOrders: orders.filter(o => ['pending', 'preparing', 'ready', 'confirmed', 'waiting_cancellation', 'waiting_cancellation_admin'].includes(o.status)).length,
      cancellations: orders.filter(o => o.status === 'cancelled').length,
      topItems: this._calculateTopItems(orders)
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
