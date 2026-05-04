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

    // Ensure body and query are initialized
    req.body = req.body || {};
    req.query = req.query || {};

    // 🕵️ Resource-Based Isolation: If an Order ID is present, we MUST check its branch
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

    // 1. Super Admin: full access
    if (user.role === 'super_admin') {
      return next();
    }

    // 2. Admin: access only to assigned branches
    if (user.role === 'admin') {
      if (!targetBranchId) return next();

      const adminBranches = await prisma.userBranch.findMany({
        where: { userId: user.id },
        select: { branchId: true }
      });

      const allowedBranchIds = [user.branchId, ...adminBranches.map(b => b.branchId)].filter(Boolean);

      if (allowedBranchIds.includes(targetBranchId)) {
        return next();
      }

      return response.error(res, 'غير مصرح لك بالوصول لبيانات هذا الفرع', 'BRANCH_ACCESS_DENIED', 403);
    }

    // 3. Branch Manager: access only to own branch
    if (user.role === 'branch_manager' || user.role === 'manager') {
      if (targetBranchId && targetBranchId !== user.branchId) {
        logger.security('BRANCH_ACCESS_DENIED', {
          userId: user.id,
          orderId,
          userBranch: user.branchId,
          targetBranchId
        });
        return response.error(res, 'يمكنك الوصول لطلبات فرعك فقط', 'BRANCH_ACCESS_DENIED', 403);
      }
      return next();
    }

    // 4. Staff/Customer: handled by other policies (or allowed if same branch)
    return next();

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
    if (user.role === 'branch_manager' || user.role === 'manager') {
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
