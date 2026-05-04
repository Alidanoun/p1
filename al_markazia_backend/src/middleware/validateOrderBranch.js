const prisma = require('../lib/prisma');
const response = require('../utils/response');
const logger = require('../utils/logger');

/**
 * 🏢 Mandatory Branch Validation Middleware
 * Ensures every order is strictly tied to a valid and active branch.
 */
module.exports = async (req, res, next) => {
  try {
    req.body = req.body || {};
    // 🛡️ Support both 'branchId' and 'branch' keys for flexibility
    const branchId = req.body.branchId || req.body.branch;

    if (!branchId) {
      return response.error(res, 'يجب تحديد الفرع (branchId is required)', 'BRANCH_REQUIRED', 400);
    }

    // 🛡️ Fetch and verify branch status from DB
    const branch = await prisma.branch.findUnique({
      where: { 
        // Support UUID or Code lookup
        ...(branchId.length > 30 ? { id: branchId } : { code: branchId.toUpperCase() })
      },
      select: { id: true, isActive: true, name: true }
    });

    if (!branch) {
      return response.error(res, 'الفرع المحدد غير موجود (Invalid Branch)', 'INVALID_BRANCH', 400);
    }

    if (!branch.isActive) {
      return response.error(res, `الفرع (${branch.name}) مغلق حالياً، يرجى اختيار فرع آخر`, 'BRANCH_CLOSED', 400);
    }

    // 🔒 Security standard: Inject the verified ID to prevent body manipulation downstream
    req.body.branchId = branch.id;
    req.validatedBranch = branch;
    
    next();
  } catch (error) {
    logger.error('validateOrderBranch Error', { error: error.message });
    return response.error(res, 'خطأ في التحقق من صحة الفرع', 'INTERNAL_ERROR', 500);
  }
};
