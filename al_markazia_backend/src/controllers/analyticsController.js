const prisma = require('../lib/prisma');
const response = require('../utils/response');
const logger = require('../utils/logger');

/**
 * 📊 Advanced Analytics Controller
 */

// Helper to get date range
const getDateRange = (period) => {
  const now = new Date();
  let start = new Date();
  
  switch (period) {
    case 'today':
      start.setHours(0, 0, 0, 0);
      break;
    case 'week':
      start.setDate(now.getDate() - 7);
      break;
    case 'month':
      start.setDate(now.getDate() - 30);
      break;
    default:
      start.setDate(now.getDate() - 7); // Default to week
  }
  return { gte: start };
};

const getDashboardStats = async (req, res) => {
  const { period = 'week' } = req.query;
  const dateRange = getDateRange(period);

  try {
    // 1. Overview Stats
    const stats = await prisma.order.aggregate({
      where: { createdAt: dateRange, status: { not: 'cancelled' } },
      _sum: { total: true },
      _count: { id: true },
      _avg: { total: true }
    });

    // 2. Top Selling Items
    const topItems = await prisma.orderItem.groupBy({
      by: ['itemName'],
      where: { order: { createdAt: dateRange, status: { not: 'cancelled' } } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 10
    });

    // 3. Peak Hours Analysis
    // We fetch orders and group them by hour in JS for better compatibility
    const orders = await prisma.order.findMany({
      where: { createdAt: dateRange },
      select: { createdAt: true }
    });

    const hourMap = {};
    // Initialize all 24 hours with 0
    for (let i = 0; i < 24; i++) hourMap[i] = 0;

    orders.forEach(order => {
      const hour = new Date(order.createdAt).getHours();
      hourMap[hour]++;
    });

    const peakHours = Object.keys(hourMap).map(hour => ({
      hour: parseInt(hour),
      count: hourMap[hour]
    }));

    // 4. Revenue Trend (Last 7 Days)
    let revenueTrend = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('day', "createdAt") as date,
        CAST(SUM(total) AS FLOAT) as revenue
      FROM "Order"
      WHERE "createdAt" >= NOW() - INTERVAL '7 days' AND status != 'cancelled'
      GROUP BY date
      ORDER BY date ASC
    `;

    // Ensure BigInt serialization safety and handle empty trend
    revenueTrend = (revenueTrend || []).map(row => ({
      date: row.date,
      revenue: Number(row.revenue) || 0
    }));

    response.success(res, {
      overview: {
        totalRevenue: Number(stats._sum.total) || 0,
        totalOrders: Number(stats._count.id) || 0,
        avgOrderValue: Number(stats._avg.total) || 0
      },
      topItems: (topItems || []).map(item => ({
        name: item.itemName,
        quantity: Number(item._sum.quantity) || 0
      })),
      peakHours,
      revenueTrend
    });

  } catch (error) {
    logger.error('Analytics Error', { error: error.message });
    response.error(res, 'حدث خطأ أثناء جلب التقارير', 'ANALYTICS_ERROR', 500);
  }
};

module.exports = { getDashboardStats };
