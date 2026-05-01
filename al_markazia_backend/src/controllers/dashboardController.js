const analyticsProjection = require('../projections/analyticsProjection');
const orderProjection = require('../projections/orderProjection');

/**
 * 🚀 Dashboard Controller (Event-Driven Read Model)
 * Purpose: Serve data directly from projections for maximum performance.
 */

/**
 * Get Real-time KPIs
 */
exports.getLiveMetrics = (req, res) => {
  const branchId = req.query.branchId || req.user.branchId;
  res.json({
    success: true,
    data: analyticsProjection.getMetrics(branchId),
    timestamp: new Date()
  });
};

/**
 * Get Live Orders (Kanban Data)
 */
exports.getLiveOrders = (req, res) => {
  const branchId = req.query.branchId || req.user.branchId;
  const filteredOrders = orderProjection.getAllOrders(branchId);
  res.json({
    success: true,
    data: filteredOrders,
    count: filteredOrders.length
  });
};
