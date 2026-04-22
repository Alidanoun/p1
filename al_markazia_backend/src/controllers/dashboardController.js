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
  res.json({
    success: true,
    data: analyticsProjection.getMetrics(),
    timestamp: new Date()
  });
};

/**
 * Get Live Orders (Kanban Data)
 */
exports.getLiveOrders = (req, res) => {
  res.json({
    success: true,
    data: orderProjection.getAllOrders(),
    count: orderProjection.getAllOrders().length
  });
};
