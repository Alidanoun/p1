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
    if (role !== 'BRANCH_MANAGER' && role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
      return response.error(res, 'غير مصرح لك بالقيام بهذا الإجراء', 'UNAUTHORIZED', 403);
    }

    // 🏢 Determine target branch (Admins can pass branchId, Managers are locked to their JWT)
    const targetBranchId = (role === 'SUPER_ADMIN' || role === 'ADMIN') ? (req.body.branchId || user.branchId) : user.branchId;

    if (!targetBranchId) {
      return response.error(res, 'يجب تحديد الفرع للقيام بهذا الإجراء', 'BRANCH_REQUIRED', 400);
    }

    // 2. 📝 Validation
    if (!itemId || typeof isAvailable !== 'boolean') {
      return response.error(res, 'بيانات غير صالحة', 'INVALID_PAYLOAD', 400);
    }

    // 3. 🔍 Verify Item Existence
    const item = await prisma.item.findUnique({ where: { id: parseInt(itemId) } });
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

    // 5. 📊 Audit Logging
    await auditService.log({
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
 * 📋 List All Branches (Admin Only)
 */
exports.getAllBranches = async (req, res) => {
  try {
    const branches = await prisma.branch.findMany({
      where: { isActive: true },
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
