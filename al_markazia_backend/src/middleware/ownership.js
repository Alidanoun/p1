const prisma = require('../lib/prisma');
const { error: responseError } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * 🛡️ Ownership Validation Middleware (Phase 3 Hardening)
 * Ensures that customers and drivers can only interact with their own orders.
 * Admins and Branch Managers (within their branch) are exempted.
 */
const verifyOrderOwnership = async (req, res, next) => {
  const orderId = req.params.id || req.params.orderId || req.body.orderId;
  const { id: userId, role, branchId: userBranchId } = req.user;

  if (!orderId) return next(); // Skip if no ID provided (let controller handle validation)

  try {
    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
      select: { id: true, customerId: true, branchId: true }
    });

    if (!order) {
      return responseError(res, 'الطلب غير موجود', 'ORDER_NOT_FOUND', 404);
    }

    // 👑 Admins can do anything
    if (role === 'admin') return next();

    // 🏢 Branch Managers can only touch orders in their branch
    if (role === 'branch_manager' || role === 'manager') {
      if (order.branchId !== userBranchId) {
        logger.security('CROSS_BRANCH_ACCESS_DENIED', { userId, orderId, orderBranch: order.branchId, userBranch: userBranchId });
        return responseError(res, 'غير مسموح لك بالوصول لطلبات فرع آخر', 'FORBIDDEN_BRANCH', 403);
      }
      return next();
    }

    // 👤 Customers can only touch their own orders
    if (role === 'customer') {
      if (order.customerId !== userId) {
        logger.security('UNAUTHORIZED_ORDER_OWNERSHIP_ATTEMPT', { userId, orderId, ip: req.ip });
        return responseError(res, 'غير مسموح لك بالوصول لهذا الطلب', 'FORBIDDEN_ACCESS', 403);
      }
      return next();
    }

    // 🚗 Drivers (If implemented in Phase 2/3)
    if (role === 'driver') {
      // Assuming driverId field exists or is coming in future
      if (order.driverId !== userId) {
        return responseError(res, 'هذا الطلب ليس معيناً لك', 'FORBIDDEN_ACCESS', 403);
      }
      return next();
    }

    // Default: Deny
    return responseError(res, 'غير مسموح لك بالقيام بهذا الإجراء', 'FORBIDDEN_ACCESS', 403);

  } catch (err) {
    logger.error('Ownership Verification Error', { error: err.message, orderId });
    return responseError(res, 'فشل التحقق من ملكية الطلب', 'INTERNAL_ERROR', 500);
  }
};

module.exports = { verifyOrderOwnership };
