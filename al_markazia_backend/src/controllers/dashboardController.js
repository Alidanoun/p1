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
  // If super_admin and no branchId in query, we want GLOBAL metrics (null)
  // Otherwise, fallback to user's branchId
  const isSuperAdmin = req.user.role === 'super_admin';
  const branchId = req.query.branchId || (isSuperAdmin ? null : req.user.branchId);
  
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
  const isSuperAdmin = req.user.role === 'super_admin';
  const branchId = req.query.branchId || (isSuperAdmin ? null : req.user.branchId);
  
  const filteredOrders = orderProjection.getAllOrders(branchId);
  res.json({
    success: true,
    data: filteredOrders,
    count: filteredOrders.length
  });
};
