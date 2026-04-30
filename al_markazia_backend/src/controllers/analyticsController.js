const { DateTime } = require('luxon');
const prisma = require('../lib/prisma');
const response = require('../utils/response');
const logger = require('../utils/logger');
const { toNumber } = require('../utils/number');

/**
 * 📊 Advanced Analytics Controller
 * Features custom grouping for operational shifts and calendar cycles.
 */

const getDashboardStats = async (req, res) => {
  const { period = 'week', source = 'all' } = req.query;
  const tz = 'Asia/Amman';
  const now = DateTime.now().setZone(tz);
  
  let start;
  let chartData = [];
  let groupBy = 'hour'; // default

  try {
    // 1. Calculate Period Range and Initialize Chart Buckets
    if (period === 'today') {
      start = now.startOf('day');
      groupBy = 'hour';
      // Buckets: 9 AM to 11 PM (23:00)
      for (let i = 9; i <= 23; i++) {
        const label = i === 12 ? '12:00 م' : (i > 12 ? `${i - 12}:00 م` : `${i}:00 ص`);
        chartData.push({ label, hour: i, count: 0 });
      }
    } 
    else if (period === 'week') {
      // Logic: Saturday to Friday
      // Luxon: 1=Mon, 6=Sat, 7=Sun
      let temp = now;
      while (temp.weekday !== 6) temp = temp.minus({ days: 1 });
      start = temp.startOf('day');
      groupBy = 'dayOfWeek';
      
      const dayNames = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
      dayNames.forEach((name, idx) => {
        // Sat=6, Sun=7, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5
        const luxonWeekday = idx === 0 ? 6 : (idx === 1 ? 7 : idx - 1);
        chartData.push({ label: name, weekday: luxonWeekday, count: 0 });
      });
    } 
    else if (period === 'month') {
      start = now.startOf('month');
      groupBy = 'dayOfMonth';
      const daysInMonth = now.daysInMonth;
      for (let i = 1; i <= daysInMonth; i++) {
        chartData.push({ label: i.toString(), day: i, count: 0 });
      }
    } else {
      start = now.minus({ days: 7 }).startOf('day');
    }

    const baseWhere = {
      createdAt: { gte: start.toJSDate() },
      status: { not: 'cancelled' }
    };

    if (source !== 'all') {
      baseWhere.source = source;
    }

    // 2. Overview Stats (Optimized Single Aggregate)
    const stats = await prisma.order.aggregate({
      where: baseWhere,
      _sum: { total: true },
      _count: { id: true },
      _avg: { total: true }
    });

    // 3. Top Selling Items
    const topItems = await prisma.orderItem.groupBy({
      by: ['itemName'],
      where: { order: baseWhere },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 10
    });

    // 4. Advanced Grouping for Charts
    const orders = await prisma.order.findMany({
      where: baseWhere,
      select: { createdAt: true }
    });

    orders.forEach(order => {
      const d = DateTime.fromJSDate(order.createdAt).setZone(tz);
      
      if (period === 'today') {
        const hour = d.hour;
        const bucket = chartData.find(b => b.hour === hour);
        if (bucket) bucket.count++;
      } 
      else if (period === 'week') {
        const weekday = d.weekday;
        const bucket = chartData.find(b => b.weekday === weekday);
        if (bucket) bucket.count++;
      } 
      else if (period === 'month') {
        const day = d.day;
        const bucket = chartData.find(b => b.day === day);
        if (bucket) bucket.count++;
      }
    });

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
      chartData,
      period
    });

  } catch (error) {
    logger.error('Advanced Analytics Error', { error: error.message, period });
    response.error(res, 'حدث خطأ أثناء تحليل البيانات المتقدمة', 'ANALYTICS_ERROR', 500);
  }
};

module.exports = { getDashboardStats };
