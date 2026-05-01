const analyticsService = require('../services/analyticsService');
const logger = require('../utils/logger');

/**
 * 📊 Analytics Controller
 */
exports.getBranchDailyReport = async (req, res) => {
  try {
    const user = req.user;
    
    // Resolve branchId (Self for manager, query param for admin)
    const normalizedRole = user.role?.toLowerCase();
    const isBranchManager = normalizedRole === 'branch_manager' || normalizedRole === 'manager';
    const branchId = isBranchManager ? user.branchId : req.query.branchId;


    // For Branch Managers, if branchId is missing, it's an error
    if (isBranchManager && !branchId) {
      return res.status(400).json({ success: false, error: 'branchId is required for branch managers' });
    }

    const report = await analyticsService.getBranchOperationalReport(branchId);
    
    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    logger.error('Failed to fetch branch report', { error: error.message });
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

/**
 * 📈 Advanced Analytics Dashboard (Admin)
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const { period = 'today', source = 'all' } = req.query;
    
    // Convert period to date range
    const now = new Date();
    let startDate = new Date();
    
    if (period === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
      startDate.setDate(now.getDate() - 7);
    } else if (period === 'month') {
      startDate.setMonth(now.getMonth() - 1);
    }

    const prisma = require('../lib/prisma');

    // Fetch orders
    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: startDate },
        status: { notIn: ['cancelled', 'waiting_cancellation', 'waiting_cancellation_admin'] }
      },
      include: { orderItems: true }
    });

    const { toNumber } = require('../utils/number');

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + toNumber(o.total || o.totalPrice), 0);
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Chart Data (Aggregating by Hour for 'today', Day for others)
    const chartMap = {};
    orders.forEach(o => {
      let label;
      if (period === 'today') {
        const hour = o.createdAt.getHours();
        label = `${hour}:00`;
      } else {
        label = o.createdAt.toLocaleDateString('ar-EG', { weekday: 'short' });
      }
      chartMap[label] = (chartMap[label] || 0) + 1;
    });

    const chartData = Object.entries(chartMap).map(([label, count]) => ({ label, count }));

    // Top Items
    const itemMap = {};
    orders.forEach(o => {
      o.orderItems.forEach(i => {
        itemMap[i.itemName] = (itemMap[i.itemName] || 0) + i.quantity;
      });
    });

    const topItems = Object.entries(itemMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, quantity]) => ({ name, quantity }));

    res.json({
      success: true,
      data: {
        overview: { totalRevenue, totalOrders, avgOrderValue },
        chartData,
        topItems
      }
    });

  } catch (error) {
    logger.error('Failed to fetch dashboard stats', { error: error.message });
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};
