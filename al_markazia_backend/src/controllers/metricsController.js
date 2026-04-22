const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { toNumber } = require('../utils/number');

/**
 * Metrics Controller - Granite Architecture
 * Provides High-level Summary and Deep Drill-down capabilities for Admin.
 */

/**
 * Returns a summary of system performance for the last 24 hours.
 */
exports.getMetricsSummary = async (req, res) => {
  try {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      totalOrders,
      approvedCancellations,
      failedNotifications,
      totalNotifications,
      lateCancelRequests
    ] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: last24h } } }),
      prisma.orderCancellation.count({ where: { createdAt: { gte: last24h }, status: 'approved' } }),
      prisma.notificationLog.count({ where: { createdAt: { gte: last24h }, status: 'failed' } }),
      prisma.notificationLog.count({ where: { createdAt: { gte: last24h } } }),
      prisma.orderCancellation.count({ where: { createdAt: { gte: last24h }, cancelledBy: 'customer', status: 'pending' } })
    ]);

    const notificationFailureRate = totalNotifications > 0 ? (failedNotifications / totalNotifications) : 0;
    const cancellationRate = totalOrders > 0 ? (approvedCancellations / totalOrders) : 0;

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalOrders,
          approvedCancellations,
          failedNotifications,
          notificationFailureRate: (notificationFailureRate * 100).toFixed(1) + '%',
          cancellationRate: (cancellationRate * 100).toFixed(1) + '%',
          pendingReview: lateCancelRequests
        },
        alerts: {
          highFailure: notificationFailureRate > 0.1,
          highCancellation: cancellationRate > 0.15
        }
      }
    });

  } catch (error) {
    logger.error('Metrics Summary Error', { error: error.message });
    res.status(500).json({ success: false, message: 'فشل في جلب البيانات العامة' });
  }
};

/**
 * Provides detailed data for specific metrics (The Drill-Down Engine).
 */
exports.getDrillDown = async (req, res) => {
  const { type, timeframe = '24h' } = req.query;
  const hours = timeframe === '7d' ? 24 * 7 : 24;
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  try {
    if (type === 'cancellations') {
      const data = await prisma.orderCancellation.findMany({
        where: { createdAt: { gte: cutoff } },
        include: { 
          order: { 
            include: { 
              orderItems: true,
              customer: { select: { name: true, phone: true } }
            } 
          } 
        },
        orderBy: { createdAt: 'desc' }
      });

      // Analyze reasons for Drill-Down insights
      const reasonStats = data.reduce((acc, curr) => {
        const r = curr.reason || 'Not Specified';
        acc[r] = (acc[r] || 0) + 1;
        return acc;
      }, {});

      return res.status(200).json({ success: true, data, insights: { reasonStats } });
    }

    if (type === 'notifications') {
      const data = await prisma.notificationLog.findMany({
        where: { createdAt: { gte: cutoff }, status: 'failed' },
        include: { customer: { select: { name: true, phone: true } } },
        orderBy: { createdAt: 'desc' }
      });

      const errorStats = data.reduce((acc, curr) => {
        const e = curr.error || 'Unknown Error';
        acc[e] = (acc[e] || 0) + 1;
        return acc;
      }, {});

      return res.status(200).json({ success: true, data, insights: { errorStats } });
    }

    return res.status(400).json({ success: false, message: 'نوع التحليل غير معروف' });

  } catch (error) {
    logger.error('Metrics Drilldown Error', { error: error.message, type });
    res.status(500).json({ success: false, message: 'فشل في تحليل البيانات العميقة' });
  }
};

/**
 * 🚀 High-Performance Dashboard Metrics
 * Custom-tailored for User's Operational Shift and Calendar Cycle.
 */
exports.getDashboardMetrics = async (req, res) => {
  try {
    const validRanges = ['day', 'week', 'month'];
    let { timeRange, page = 1, limit = 5 } = req.query;
    if (!validRanges.includes(timeRange)) timeRange = 'day';

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const now = new Date();
    let startDate;
    let chartData = [];

    // 🛡️ 1. Specific Business Logic for Time Windows
    if (timeRange === 'day') {
      // Logic: From 8:00 AM Today to 11:00 PM Today
      startDate = new Date();
      startDate.setHours(8, 0, 0, 0);
      
      const endDate = new Date();
      endDate.setHours(23, 0, 0, 0);

      // Fetch
      const orders = await prisma.order.findMany({
        where: { status: 'delivered', createdAt: { gte: startDate, lte: endDate } },
        select: { createdAt: true, subtotal: true }
      });

      // Generate Buckets (8 AM to 11 PM)
      for (let h = 8; h <= 23; h++) {
        const name = `${h > 12 ? h - 12 : h}:00 ${h >= 12 ? 'م' : 'ص'}`;
        const sales = orders
          .filter(o => new Date(o.createdAt).getHours() === h)
          .reduce((acc, curr) => acc + toNumber(curr.subtotal || 0), 0);
        chartData.push({ name, 'مبيعات': sales });
      }
    } 
    else if (timeRange === 'week') {
      // Logic: Last 4 Weeks Summary
      startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
      startDate.setHours(0, 0, 0, 0);

      const orders = await prisma.order.findMany({
        where: { status: 'delivered', createdAt: { gte: startDate } },
        select: { createdAt: true, subtotal: true }
      });

      // Generate 4 Buckets
      for (let w = 0; w < 4; w++) {
        const wStart = new Date(startDate.getTime() + w * 7 * 24 * 60 * 60 * 1000);
        const wEnd = new Date(wStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        
        const sales = orders
          .filter(o => {
            const d = new Date(o.createdAt);
            return d >= wStart && d < wEnd;
          })
          .reduce((acc, curr) => acc + toNumber(curr.subtotal || 0), 0);
          
        chartData.push({ name: `الأسبوع ${w + 1}`, 'مبيعات': sales });
      }
    } 
    else if (timeRange === 'month') {
      // Logic: Current Calendar Month (1st to Last Day)
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

      const orders = await prisma.order.findMany({
        where: { status: 'delivered', createdAt: { gte: startDate } },
        select: { createdAt: true, subtotal: true }
      });

      // Generate Day-by-Day (1 to 30/31)
      for (let d = 1; d <= daysInMonth; d++) {
        const bucketDate = new Date(now.getFullYear(), now.getMonth(), d);
        const name = bucketDate.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
        const fullName = bucketDate.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
        
        const sales = orders
          .filter(o => {
            const dObj = new Date(o.createdAt);
            return dObj.getDate() === d && dObj.getMonth() === now.getMonth();
          })
          .reduce((acc, curr) => acc + toNumber(curr.subtotal || 0), 0);
          
        chartData.push({ name, 'fullDate': fullName, 'مبيعات': sales });
      }
    }

    const [statsResult, activeOrdersCount, topItemsRaw, recentOrdersRaw] = await Promise.all([
      prisma.order.aggregate({
        where: { 
          status: 'delivered',
          createdAt: { gte: startDate }
        },
        _sum: { subtotal: true },
        _count: { id: true }
      }),
      prisma.order.count({
        where: { status: { in: ['pending', 'preparing', 'ready'] } }
      }),
      prisma.orderItem.groupBy({
        by: ['itemId', 'itemName'],
        where: { 
          order: { status: 'delivered' },
          item: { excludeFromStats: false } 
        },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5
      }),
      prisma.order.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { 
          customer: { select: { name: true, phone: true } }
        }
      })
    ]);

    const stats = statsResult || { _sum: { subtotal: 0 }, _count: { id: 0 } };

    res.json({
      success: true,
      data: {
        revenue: stats._sum?.subtotal || 0,
        orders: stats._count?.id || 0,
        activeOrders: activeOrdersCount || 0,
        topItem: topItemsRaw[0]?.itemName || 'N/A',
        chartData,
        topItemsList: (topItemsRaw || []).map(item => ({
          itemId: item.itemId || 0,
          name: item.itemName || 'صنف غير معروف',
          orders: item._sum?.quantity || 0,
          revenue: item._sum?.lineTotal || 0
        })),
        recentOrdersList: (recentOrdersRaw || []).map(o => ({
          id: o.id,
          customerName: o.customer?.name || 'زائر',
          subtotal: toNumber(o.subtotal || 0),
          status: o.status,
          createdAt: o.createdAt
        }))
      }
    });

  } catch (error) {
    logger.error('Dashboard metrics aggregation error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to aggregate dashboard metrics' });
  }
};
