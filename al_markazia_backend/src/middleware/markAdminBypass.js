const { traceContext } = require('../utils/context');
const logger = require('../utils/logger');

/**
 * 🛡️ markAdminBypass Middleware
 * Must be used on any route that:
 *   1. Uses `isAdmin` role-guard, AND
 *   2. Operates across all branches (no BranchAccessMiddleware), AND
 *   3. Touches an RLS-enabled table (Order, Lead, Opportunity, SalesActivity)
 *
 * Without this, the Prisma RLS extension's fail-closed logic will throw a 500
 * because there is no branchId in the traceContext for these cross-branch admin routes.
 *
 * Usage:
 *   router.post('/close-day', authMiddleware, isAdmin, markAdminBypass, idempotency.guard(true), controller);
 */
const markAdminBypass = (req, res, next) => {
  const store = traceContext.getStore() || {};

  if (!req.user || req.user.role?.toLowerCase() !== 'admin') {
    logger.security('[markAdminBypass] Non-admin attempted to use admin bypass middleware', {
      userId: req.user?.id,
      role: req.user?.role,
      path: req.originalUrl
    });
    return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'غير مصرح' });
  }

  // Propagate existing store keys, and explicitly set isAdmin = true
  traceContext.run({ ...store, isAdmin: true, bypassRls: true }, () => {
    next();
  });
};

module.exports = markAdminBypass;
