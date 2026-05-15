const prisma = require('../lib/prisma');
const response = require('../utils/response');
const logger = require('../utils/logger');
const auditService = require('../services/auditService');

/**
 * 🏢 Branch Operations Controller
 * Handles branch-specific business logic and availability management.
 */

/**
 * 🔄 Toggle Item Availability (Branch-Specific)
 * Implements "Lazy Creation" strategy for menu overrides.
 */
exports.toggleItemAvailability = async (req, res) => {
  try {
    const { itemId, isAvailable } = req.body;
    const user = req.user;
    const role = user.role?.toUpperCase();

    // 1. 🔐 Security & Role Check
    const ALLOWED_ROLES = ['BRANCH_MANAGER', 'MANAGER', 'ADMIN', 'STAFF'];
    if (!ALLOWED_ROLES.includes(role)) {
      return response.error(res, 'غير مصرح لك بالقيام بهذا الإجراء', 'UNAUTHORIZED', 403);
    }

    // 2. 🏢 Target Branch Resolution
    let targetBranchId = req.body.branchId || user.branchId;
    
    // 🛡️ [SEC-FIX] Sanitize stringified nulls
    if (targetBranchId === 'null' || targetBranchId === 'undefined') targetBranchId = null;

    if (!targetBranchId) {
      return response.error(res, 'يجب تحديد الفرع للقيام بهذا الإجراء', 'BRANCH_REQUIRED', 400);
    }

    // 🔐 [PHASE 4] Explicit Authorization Check
    const SecurityPolicyService = require('../services/securityPolicyService');
    const canAccess = await SecurityPolicyService.canAccessBranch(user, targetBranchId, 'write');
    
    if (!canAccess) {
      logger.security('UNAUTHORIZED_ITEM_TOGGLE_ATTEMPT', { userId: user.id, targetBranchId });
      return response.error(res, 'غير مصرح لك بالتحكم في أصناف هذا الفرع', 'FORBIDDEN', 403);
    }

    // 2. 📝 Validation
    const parsedItemId = parseInt(itemId);
    if (isNaN(parsedItemId) || typeof isAvailable !== 'boolean') {
      return response.error(res, 'بيانات غير صالحة', 'INVALID_PAYLOAD', 400);
    }

    // 3. 🔍 Verify Item Existence
    const item = await prisma.item.findUnique({ where: { id: parsedItemId } });
    if (!item) {
      return response.error(res, 'الصنف غير موجود', 'ITEM_NOT_FOUND', 404);
    }

    // 4. 🧠 Lazy Upsert Logic
    const existing = await prisma.branchItem.findUnique({
      where: {
        branchId_itemId: {
          branchId: targetBranchId,
          itemId: item.id
        }
      }
    });

    // Idempotency check: No need to update if state is identical
    if (existing && existing.isAvailable === isAvailable) {
      return response.success(res, { 
        message: 'الحالة لم تتغير', 
        data: existing 
      });
    }

    let result;
    if (!existing) {
      // 🚀 Lazy Creation: Create record only when first modified
      result = await prisma.branchItem.create({
        data: {
          branchId: targetBranchId,
          itemId: item.id,
          isAvailable
        }
      });
      logger.info(`[BranchService] Created availability override for item ${item.id} in branch ${targetBranchId}`);
    } else {
      // 🔄 Standard Update
      result = await prisma.branchItem.update({
        where: { id: existing.id },
        data: { isAvailable }
      });
      logger.info(`[BranchService] Updated availability for item ${item.id} in branch ${targetBranchId} to ${isAvailable}`);
    }

    // 5. 📊 Audit Logging (Synchronous for consistency with Inventory Consumers)
    await auditService.logSync({
      action: 'ITEM_AVAILABILITY_TOGGLED',
      userId: user.id,
      userRole: user.role,
      metadata: {
        itemId: item.id,
        itemName: item.title,
        branchId: targetBranchId,
        newState: isAvailable,
        previousState: existing ? existing.isAvailable : true
      },
      req
    });

    // 6. ⚡ [PHASE 3] Branch-Aware Cache Invalidation
    const menuCacheService = require('../services/menuCacheService');
    await menuCacheService.invalidate(targetBranchId);

    return response.success(res, {
      message: `تم ${isAvailable ? 'تفعيل' : 'إيقاف'} الصنف بنجاح`,
      data: result
    });

  } catch (error) {
    logger.error('Toggle item availability error', { error: error.message });
    return response.error(res, 'حدث خطأ أثناء تحديث حالة الصنف', 'SERVER_ERROR', 500);
  }
};

/**
 * 📋 List All Branches (Filtered by role)
 */
exports.getAllBranches = async (req, res) => {
  try {
    const user = req.user;
    const where = { isActive: true, isDeleted: false };

    // 🛡️ [SEC-FIX] Branch Isolation for Managers
    if (user?.role?.toUpperCase() === 'BRANCH_MANAGER' && user?.branchId) {
      where.id = user.branchId;
    }

    const branches = await prisma.branch.findMany({
      where,
      select: {
        id: true,
        name: true,
        address: true,
        phone: true
      },
      orderBy: { name: 'asc' }
    });
    
    return res.json({ success: true, data: branches });
  } catch (error) {
    logger.error('Get all branches error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

/**
 * 🔄 Switch Branch Context (HTTP Endpoint)
 */
exports.switchBranch = async (req, res) => {
  try {
    const { from, to } = req.body;
    const user = req.user;
    
    if (!to) {
      return response.error(res, 'يجب تحديد الفرع المستهدف', 'BRANCH_REQUIRED', 400);
    }

    // 1. Validate Target Branch
    const branch = await prisma.branch.findFirst({
      where: { id: to, isDeleted: false },
      select: { id: true, name: true, isActive: true }
    });

    if (!branch || !branch.isActive) {
      return response.error(res, 'الفرع المحدد غير موجود أو غير نشط', 'INVALID_BRANCH', 400);
    }

    // 2. Security Check
    const SecurityPolicyService = require('../services/securityPolicyService');
    const canAccess = await SecurityPolicyService.canAccessBranch(user, to, 'read');

    if (!canAccess) {
      await auditService.log({
        userId: user.id,
        userRole: user.role,
        action: 'BRANCH_SWITCH_FORBIDDEN',
        severity: 'HIGH',
        status: 'FAIL',
        metadata: { from, to },
        req
      });
      return response.error(res, 'غير مصرح لك بالوصول لهذا الفرع', 'FORBIDDEN', 403);
    }

    // 3. Audit Log (Success)
    await auditService.logBranchSwitch(user.id, user.role, from, to, req);

    return response.success(res, {
      message: `تم الانتقال بنجاح إلى ${branch.name}`,
      branchId: to
    });

  } catch (error) {
    logger.error('Branch switch error', { error: error.message });
    return response.error(res, 'حدث خطأ أثناء تبديل الفرع', 'SERVER_ERROR', 500);
  }
};

/**
 * 🗑️ Soft-Delete Branch
 * Replaces hard deletion to preserve financial and audit history.
 */
exports.deleteBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // 🔐 Only Admins can delete branches
    if (user.role?.toUpperCase() !== 'ADMIN') {
      return response.error(res, 'غير مصرح لك بحذف الفروع', 'UNAUTHORIZED', 403);
    }

    // 🔍 Verify existence
    const branch = await prisma.branch.findUnique({ where: { id } });
    if (!branch || branch.isDeleted) {
      return response.error(res, 'الفرع غير موجود', 'BRANCH_NOT_FOUND', 404);
    }

    // 🔄 Perform Soft-Delete
    await prisma.branch.update({
      where: { id },
      data: {
        isDeleted: true,
        isActive: false,
        deletedAt: new Date()
      }
    });

    // 📊 Audit Log
    await auditService.log({
      action: 'BRANCH_DELETED_SOFT',
      userId: user.id,
      userRole: user.role,
      metadata: { branchId: id, branchName: branch.name },
      req
    });

    return response.success(res, { message: 'تم حذف الفرع بنجاح (حذف منطقي)' });

  } catch (error) {
    logger.error('Delete branch error', { error: error.message });
    return response.error(res, 'حدث خطأ أثناء حذف الفرع', 'SERVER_ERROR', 500);
  }
};
