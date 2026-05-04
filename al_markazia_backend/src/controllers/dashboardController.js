const analyticsProjection = require('../projections/analyticsProjection');
const orderProjection = require('../projections/orderProjection');

/**
 * 🚀 Dashboard Controller (Event-Driven Read Model)
 * Purpose: Serve data directly from projections for maximum performance.
 */

/**
 * Get Real-time KPIs
 */
exports.getLiveMetrics = async (req, res) => {
  try {
    const SecurityPolicyService = require('../services/securityPolicyService');
    const { getContext } = require('../utils/securityContext');
    const isolationFilter = await SecurityPolicyService.getHardenedFilter(getContext(), 'Order');

    // Extract branchId from the security filter
    // Prisma filter for branchId is usually { in: [...] } or { equals: ... } or just UUID
    let branchId = null;
    if (isolationFilter.branchId) {
      if (typeof isolationFilter.branchId === 'string') {
        branchId = isolationFilter.branchId;
      } else if (isolationFilter.branchId.in && isolationFilter.branchId.in.length === 1) {
        branchId = isolationFilter.branchId.in[0];
      }
    }

    res.json({
      success: true,
      data: analyticsProjection.getMetrics(branchId),
      timestamp: new Date()
    });
  } catch (error) {
    res.status(403).json({ success: false, error: 'Unauthorized Branch Access' });
  }
};

/**
 * Get Live Orders (Kanban Data)
 */
exports.getLiveOrders = async (req, res) => {
  try {
    const SecurityPolicyService = require('../services/securityPolicyService');
    const { getContext } = require('../utils/securityContext');
    const isolationFilter = await SecurityPolicyService.getHardenedFilter(getContext(), 'Order');

    let branchId = null;
    if (isolationFilter.branchId) {
      if (typeof isolationFilter.branchId === 'string') {
        branchId = isolationFilter.branchId;
      } else if (isolationFilter.branchId.in && isolationFilter.branchId.in.length === 1) {
        branchId = isolationFilter.branchId.in[0];
      }
    }
    
    const filteredOrders = orderProjection.getAllOrders(branchId);
    res.json({
      success: true,
      data: filteredOrders,
      count: filteredOrders.length
    });
  } catch (error) {
    res.status(403).json({ success: false, error: 'Unauthorized Branch Access' });
  }
};
