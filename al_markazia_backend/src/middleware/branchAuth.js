const prisma = require('../lib/prisma');
const response = require('../utils/response');
const logger = require('../utils/logger');
const auditService = require('../services/auditService');

/**
 * 🏢 Branch Authorization Middleware
 * يتحقق من صلاحية المستخدم للوصول للفرع المطلوب
 * 
 * الاستخدام:
 * router.post('/endpoint', authenticateToken, requireBranchAccess, controller)
 */
const requireBranchAccess = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      return response.error(res, 'يجب تسجيل الدخول أولاً', 'UNAUTHORIZED', 401);
    }

    const SecurityPolicyService = require('../services/securityPolicyService');
    const intent = ['GET', 'HEAD'].includes(req.method) ? 'read' : 'write';

    req.body = req.body || {};
    req.query = req.query || {};

    // 🕵️ Resource-Based Isolation: Resolve target branch from params or body
    const orderId = req.params.id || req.params.orderId;
    let targetBranchId = req.body.branchId || req.query.branchId || req.params.branchId;

    if (orderId && !isNaN(parseInt(orderId))) {
      const order = await prisma.order.findUnique({
        where: { id: parseInt(orderId) },
        select: { branchId: true }
      });

      if (!order) {
        return response.error(res, 'الطلب غير موجود', 'ORDER_NOT_FOUND', 404);
      }
      targetBranchId = order.branchId;
    }

    // 🛡️ Collection List Bypass: If no specific branch is requested for a read operation, 
    // allow it. The Data Isolation layer (getHardenedFilter) will filter the results.
    if (!targetBranchId && intent === 'read') {
      return next();
    }

    const isAuthorized = await SecurityPolicyService.canAccessBranch(user, targetBranchId, intent);

    if (isAuthorized) {
      return next();
    }

    logger.security('BRANCH_ACCESS_DENIED', {
      userId: user.id,
      role: user.role,
      targetBranchId,
      intent,
      endpoint: req.originalUrl
    });

    return response.error(res, 'غير مصرح لك بالوصول لبيانات هذا الفرع', 'BRANCH_ACCESS_DENIED', 403);

  } catch (error) {
    logger.error('Branch authorization error', { error: error.message });
    return response.error(res, 'خطأ في التحقق من صلاحيات الفرع', 'AUTH_ERROR', 500);
  }
};

/**
 * 🔒 Ensure Branch ID (يفرض وجود branchId)
 * يستخدم لـ endpoints التي تتطلب branchId إلزامياً
 */
const ensureBranchId = (req, res, next) => {
  const user = req.user;
  
  if (!user) {
    return response.error(res, 'يجب تسجيل الدخول أولاً', 'UNAUTHORIZED', 401);
  }

  // Ensure body and query are initialized
  req.body = req.body || {};
  req.query = req.query || {};

  const branchId = req.body.branchId || req.query.branchId || req.params.branchId;

  if (!branchId) {
    // للـ branch managers، استخدم فرعهم تلقائياً
    const userRole = user.role?.toLowerCase();
    if (userRole === 'branch_manager' || userRole === 'manager') {
      req.body.branchId = user.branchId;
      req.query.branchId = user.branchId;
      return next();
    }

    return response.error(res, 'يجب تحديد الفرع', 'BRANCH_REQUIRED', 400);
  }

  next();
};

/**
 * 🕵️ Ensure Valid Branch (يتحقق من وجود الفرع وصحته)
 * يُستخدم لعمليات إنشاء الطلب لضمان توجيه الطلب لفرع صالح ونشط
 */
const ensureValidBranch = async (req, res, next) => {
  try {
    req.body = req.body || {};
    // 🛡️ [SECURITY-FIX] Support both branchId and branch (legacy) keys
    const branchId = req.body.branchId || req.query.branchId || req.body.branch;
    
    if (!branchId) {
      return response.error(res, 'يجب تحديد الفرع (branchId مطلوب)', 'BRANCH_REQUIRED', 400);
    }

    // 🛡️ [SECURITY-FIX] Fetch branch from DB instead of trusting request
    const branch = await prisma.branch.findUnique({
      where: { 
        // Handle both UUID and Code resolution
        ...(branchId.length > 30 ? { id: branchId } : { code: branchId.toUpperCase() })
      },
      select: { id: true, isActive: true, name: true }
    });

    if (!branch) {
      return response.error(res, 'الفرع المحدد غير موجود (Invalid Branch ID/Code)', 'INVALID_BRANCH', 400);
    }

    if (!branch.isActive) {
      return response.error(res, `فرع (${branch.name}) مغلق حالياً، يرجى اختيار فرع آخر`, 'BRANCH_CLOSED', 400);
    }

    // 🔒 Injection Prevention: Inject the verified ID back into the body
    req.body.branchId = branch.id;
    req.validatedBranch = branch; // 🛡️ Professional standard: pass the validated object
    
    next();
  } catch (error) {
    logger.error('Branch validation middleware error', { error: error.message });
    return response.error(res, 'خطأ في التحقق من صلاحية الفرع', 'INTERNAL_ERROR', 500);
  }
};

module.exports = { 
  requireBranchAccess,
  ensureBranchId,
  ensureValidBranch
};
