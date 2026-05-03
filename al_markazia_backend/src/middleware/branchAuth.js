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

    // Ensure body and query are initialized for safe assignment later
    req.body = req.body || {};
    req.query = req.query || {};

    const requestedBranchId = req.body.branchId || req.query.branchId || req.params.branchId;

    // 1. Super Admin: وصول كامل لكل الفروع
    if (user.role === 'super_admin') {
      // Audit log for cross-branch access
      if (requestedBranchId && requestedBranchId !== user.branchId) {
        await auditService.log({
          action: 'CROSS_BRANCH_ACCESS',
          userId: user.id,
          userRole: user.role,
          severity: 'INFO',
          metadata: { 
            userBranch: user.branchId, 
            accessedBranch: requestedBranchId,
            endpoint: req.originalUrl
          },
          req
        });
      }
      return next();
    }

    // 2. Admin: وصول للفروع المخصصة له فقط
    if (user.role === 'admin') {
      // إذا لم يطلب فرع معين، استخدم فرعه الافتراضي
      if (!requestedBranchId) {
        return next();
      }

      // التحقق من الفروع المسموح بها
      const adminBranches = await prisma.userBranch.findMany({
        where: { userId: user.id }, // Use UUID directly
        select: { branchId: true }
      });

      const allowedBranchIds = [
        user.branchId, // الفرع الأساسي
        ...adminBranches.map(b => b.branchId)
      ].filter(Boolean);

      if (allowedBranchIds.includes(requestedBranchId)) {
        return next();
      }

      // رفض الوصول
      logger.security('BRANCH_ACCESS_DENIED', {
        userId: user.id,
        userRole: user.role,
        userBranch: user.branchId,
        requestedBranch: requestedBranchId,
        endpoint: req.originalUrl,
        ip: req.ip
      });

      return response.error(res, 'غير مصرح لك بالوصول لهذا الفرع', 'BRANCH_ACCESS_DENIED', 403);
    }

    // 3. Branch Manager: وصول لفرعه فقط
    if (user.role === 'branch_manager' || user.role === 'manager') {
      // إذا طُلب فرع مختلف، رفض
      if (requestedBranchId && requestedBranchId !== user.branchId) {
        logger.security('BRANCH_ACCESS_DENIED', {
          userId: user.id,
          userRole: user.role,
          userBranch: user.branchId,
          requestedBranch: requestedBranchId,
          endpoint: req.originalUrl,
          ip: req.ip
        });

        return response.error(res, 'يمكنك الوصول لفرعك فقط', 'BRANCH_ACCESS_DENIED', 403);
      }

      // فرض استخدام فرعه الخاص
      req.body.branchId = user.branchId;
      req.query.branchId = user.branchId;
      
      return next();
    }

    // 4. Staff/Customer: لا يحتاجون لصلاحيات فروع
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

module.exports = { 
  requireBranchAccess,
  ensureBranchId
};
