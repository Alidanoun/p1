const prisma = require('../lib/prisma');
const response = require('../utils/response');
const logger = require('../utils/logger');
const SecurityPolicyService = require('../services/securityPolicyService');

/**
 * 🔒 BranchAccessMiddleware (The Authority)
 * Enforces strict branch isolation and ownership verification.
 * Does NOT trust frontend-provided branch IDs for non-admins.
 */
const BranchAccessMiddleware = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return response.error(res, 'UNAUTHORIZED', 'AUTH_ERROR', 401);

    const role = user.role?.toLowerCase();
    const isGlobalAdmin = role === 'admin';
    
    // 1. Resolve Target IDs from Request
    const orderId = req.params.orderId || req.params.id; // Handles both /orders/:id and /orders/:orderId
    const approvalId = req.params.approvalId || (req.originalUrl.includes('/financial/approvals/') ? req.params.id : null);
    
    let authoritativeBranchId = null;

    // 🎯 PILLAR A: Order Ownership Verification
    if (orderId && !isNaN(parseInt(orderId))) {
      const order = await prisma.order.findUnique({
        where: { id: parseInt(orderId) },
        select: { branchId: true }
      });
      if (!order) return response.error(res, 'الطلب غير موجود', 'ORDER_NOT_FOUND', 404);
      authoritativeBranchId = order.branchId;
    }

    // 🎯 PILLAR B: Approval Ownership Verification
    if (approvalId) {
      const approval = await prisma.financialApproval.findUnique({
        where: { id: approvalId },
        select: { branchId: true }
      });
      if (!approval) return response.error(res, 'طلب الموافقة غير موجود', 'APPROVAL_NOT_FOUND', 404);
      
      // If order-based approval, use its branch
      authoritativeBranchId = approval.branchId;
    }

    // 🎯 PILLAR C: Request-Level Branch Resolution (Header/Query/Body)
    // If no specific entity ID was found, check for branchId in request
    if (!authoritativeBranchId) {
      authoritativeBranchId = req.headers['x-branch-context'] || req.query.branchId || req.body?.branchId;
    }

    // 🛡️ [SECURITY-FIX] For Managers: Always override or validate branchId
    if (!isGlobalAdmin && (role === 'branch_manager' || role === 'manager')) {
      // If a manager tries to access a branch other than their own, we block or force theirs
      if (authoritativeBranchId && authoritativeBranchId !== user.branchId) {
        // Double-check multi-branch access from SecurityPolicy
        const canAccess = await SecurityPolicyService.canAccessBranch(user, authoritativeBranchId, 'read');
        if (!canAccess) {
          logger.security('BRANCH_ISOLATION_VIOLATION_ATTEMPT', { 
            userId: user.id, 
            attemptedBranch: authoritativeBranchId, 
            actualBranch: user.branchId 
          });
          return response.error(res, 'غير مصرح لك بالوصول لبيانات هذا الفرع', 'BRANCH_FORBIDDEN', 403);
        }
      } else {
        // If no branchId provided, force the manager's assigned branch
        authoritativeBranchId = user.branchId;
      }
    }

    // 👑 Fail-Safe: If it's a manager and we STILL don't have a branchId, something is wrong
    if (!isGlobalAdmin && (role === 'branch_manager' || role === 'manager') && !authoritativeBranchId) {
      logger.error('CRITICAL_SECURITY_HOLE: Manager with no branch assignment', { userId: user.id });
      return response.error(res, 'خطأ في إعدادات الحساب: الفرع غير محدد', 'CONFIG_ERROR', 500);
    }

    // 💾 Inject into Request for Controller use
    req.authoritativeBranchId = authoritativeBranchId;
    
    // Standardize query/body for legacy controllers that expect branchId there
    if (authoritativeBranchId) {
       if (!req.query) req.query = {};
       req.query.branchId = authoritativeBranchId;
       
       if (req.body) {
         req.body.branchId = authoritativeBranchId;
       }
    }

    // 🔗 [PHASE 3] Propagation: Update Trace Context with BranchID
    const { traceContext } = require('../utils/context');
    const store = traceContext.getStore() || {};
    
    traceContext.run({ ...store, branchId: authoritativeBranchId }, () => {
       next();
    });
  } catch (error) {
    logger.error('BranchAccessMiddleware Error', { error: error.message, stack: error.stack });
    return response.error(res, 'Internal Security Error', 'SECURITY_ERROR', 500);
  }
};

module.exports = BranchAccessMiddleware;
