const prisma = require('../lib/prisma');
const { DateTime } = require('luxon');

/**
 * 📊 Analytics & Reporting Service
 * Operational-first reporting for branches and super admins.
 */
class AnalyticsService {
  
  /**
   * 🏪 Get Light Operational Report for a Branch
   */
  async getBranchOperationalReport(branchId) {
    const now = DateTime.now().setZone('Asia/Amman');
    const start = now.startOf('day').toJSDate();
    const end = now.endOf('day').toJSDate();

    // 1. Fetch Today's Orders for Branch
    const orders = await prisma.order.findMany({
      where: {
        branchId: branchId,
        createdAt: { gte: start, lte: end }
      },
      select: {
        id: true,
        status: true,
        total: true,
        orderItems: {
          select: {
            itemName: true,
            quantity: true
          }
        }
      }
    });

    // 2. Calculate Operational Metrics
    const metrics = {
      totalOrders: orders.length,
      activeOrders: orders.filter(o => ['pending', 'preparing', 'ready', 'confirmed'].includes(o.status)).length,
      cancellations: orders.filter(o => o.status === 'cancelled' || o.status.includes('waiting_cancellation')).length,
      topItems: this._calculateTopItems(orders)
    };

    return metrics;
  }

  /**
   * 🛠️ Internal: Calculate best sellers from order list
   */
  _calculateTopItems(orders) {
    const itemCounts = {};
    
    orders.forEach(order => {
      order.orderItems.forEach(item => {
        const name = item.itemName;
        itemCounts[name] = (itemCounts[name] || 0) + item.quantity;
      });
    });

    // Sort and return top 3
    return Object.entries(itemCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));
  }

  /**
   * ⚡ Incremental Cache Update (Placeholder for Real-time Dashboards)
   * Prevents runtime errors during order lifecycle hooks.
   */
  updateCacheIncrementally(data) {
    // Currently, our 'Light Reporting' fetches fresh data on each poll.
    // In future versions, this can be used to update Redis-based counters instantly.
    return true;
  }
}

module.exports = new AnalyticsService();
