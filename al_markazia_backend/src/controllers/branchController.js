const prisma = require('../lib/prisma');
const response = require('../utils/response');
const logger = require('../utils/logger');
const auditService = require('../services/auditService');
const { encrypt, hashBlind } = require('../utils/crypto');
const bcrypt = require('bcrypt');
const { BCRYPT_ROUNDS } = require('../config/secrets');
const redis = require('../lib/redis');

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
      // ✅ Log event even if state is identical (Idempotent call tracking)
      await auditService.logSync({
        action: 'ITEM_TOGGLE_IDEMPOTENT',
        userId: user.id,
        userRole: user.role,
        metadata: {
          itemId: item.id,
          itemName: item.title,
          branchId: targetBranchId,
          requestedValue: isAvailable,
          currentValue: existing.isAvailable,
          reason: 'No state transition required'
        },
        req
      });

      return response.success(res, { 
        message: 'الحالة بالفعل كما هو مطلوب (لم تتغير)', 
        data: existing,
        idempotent: true
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
    const where = { isDeleted: false };
 
    // 🛡️ [SEC-FIX] Branch Isolation for Managers
    if (user?.role?.toUpperCase() === 'BRANCH_MANAGER' && user?.branchId) {
      where.id = user.branchId;
    }
 
    const branches = await prisma.branch.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        phone: true,
        isActive: true,
        isEmergencyClosed: true,
        users: {
          where: { role: { in: ['manager', 'branch_manager'], mode: 'insensitive' } },
          select: { email: true, plainPin: true },
          take: 1
        }
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

    const io = require('../socket').getIO();
    io?.emit('branch:updated');

    return response.success(res, { message: 'تم حذف الفرع بنجاح (حذف منطقي)' });

  } catch (error) {
    logger.error('Delete branch error', { error: error.message });
    return response.error(res, 'حدث خطأ أثناء حذف الفرع', 'SERVER_ERROR', 500);
  }
};

/**
 * 🔍 Validate Branch Access
 * Checks if the current authenticated user is authorized to access a branch.
 * Prevents IDOR by using req.user from JWT context.
 */
exports.validateBranchAccess = async (req, res) => {
  try {
    const { branchId } = req.body;
    const user = req.user;

    if (!branchId) {
      return res.json({ success: true, canAccess: false, message: 'Branch ID is required' });
    }

    // Standardize branchId (prevent stringified nulls/undefined)
    if (branchId === 'null' || branchId === 'undefined') {
      return res.json({ success: true, canAccess: false, message: 'Invalid Branch ID' });
    }

    // Call SecurityPolicyService to check access
    const SecurityPolicyService = require('../services/securityPolicyService');
    const canAccess = await SecurityPolicyService.canAccessBranch(user, branchId, 'read');

    return res.json({
      success: true,
      canAccess
    });
  } catch (error) {
    logger.error('Validate branch access error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

/**
 * 🏢 Create New Branch (with Manager and custom Permissions)
 */
exports.createBranch = async (req, res) => {
  try {
    const user = req.user;
    if (user.role?.toUpperCase() !== 'ADMIN') {
      return response.error(res, 'غير مصرح لك بإنشاء فروع جديدة', 'UNAUTHORIZED', 403);
    }

    const {
      name,
      address,
      phone,
      managerEmail,
      managerPassword,
      managerPin,
      allowedPermissions,
      visibleInApp,
      appDisplayOrder
    } = req.body;
    let { code } = req.body;

    if (!name || !code || !managerEmail || !managerPassword || !managerPin) {
      return response.error(res, 'الاسم والكود والبريد الإلكتروني وكلمة المرور والـ PIN مطلوبة', 'INVALID_PAYLOAD', 400);
    }
    
    code = code.trim().toUpperCase();

    // 1. Password Strength Validation
    const { validatePasswordStrength } = require('../utils/security');
    const strength = validatePasswordStrength(managerPassword);
    if (!strength.isValid) {
      return response.error(res, strength.message, 'INVALID_PASSWORD', 400);
    }

    // 2. PIN Validation (4 digits)
    if (!managerPin || !/^\d{4}$/.test(managerPin)) {
      return response.error(res, 'يجب أن يكون رقم PIN للمدير مكوناً من 4 أرقام', 'INVALID_PIN', 400);
    }

    // 3. Email Check
    const emailHash = hashBlind(managerEmail.toLowerCase().trim());
    const existingUser = await prisma.user.findUnique({ where: { emailHash } });
    if (existingUser) {
      return response.error(res, 'البريد الإلكتروني لمدير الفرع مستخدم بالفعل', 'EMAIL_ALREADY_EXISTS', 400);
    }

    // 4. Branch Code Check (including soft-deleted ones)
    const existingBranch = await prisma.branch.findUnique({ where: { code } });
    if (existingBranch) {
      return response.error(res, 'كود الفرع مستخدم بالفعل', 'BRANCH_CODE_EXISTS', 400);
    }

    // 5. DB Transaction to create branch, manager, userbranch, and permissions
    const result = await prisma.$transaction(async (tx) => {
      // A. Create Branch
      const branch = await tx.branch.create({
        data: {
          name,
          code,
          address: address || null,
          phone: phone ? encrypt(phone) : null,
          isActive: true,
          visibleInApp: typeof visibleInApp === 'boolean' ? visibleInApp : true,
          appDisplayOrder: typeof appDisplayOrder === 'number' ? appDisplayOrder : 0
        }
      });

      // B. Hash credentials
      const hashedPassword = await bcrypt.hash(managerPassword, BCRYPT_ROUNDS || 12);
      const hashedPin = await bcrypt.hash(managerPin, BCRYPT_ROUNDS || 12);
      const encryptedEmail = encrypt(managerEmail.toLowerCase().trim());
      const encryptedName = encrypt(name + ' Manager');

      // C. Create Manager User
      const managerUser = await tx.user.create({
        data: {
          email: encryptedEmail,
          emailHash,
          name: encryptedName,
          password: hashedPassword,
          pinHash: hashedPin,
          role: 'BRANCH_MANAGER',
          branchId: branch.id,
          isActive: true
        }
      });

      // D. Create UserBranch link
      await tx.userBranch.create({
        data: {
          userId: managerUser.id,
          branchId: branch.id
        }
      });

      // E. Create BranchPermissions
      const defaultPermissions = {
        liveOrders: 'FULL',
        manageOrders: 'FULL',
        menu: 'FULL',
        notifications: 'FULL',
        reviews: 'VIEW',
        loyalty: 'VIEW',
        rewardsStore: 'NONE',
        advancedAnalytics: 'VIEW',
        financials: 'VIEW',
        deliveryZones: 'EDIT_PIN',
        auditLog: 'VIEW',
        settings: 'EDIT_PIN',
        canToggleLiveMode: false,
        canModifyWorkHours: 'EDIT_PIN'
      };

      const permsData = {
        branchId: branch.id,
        updatedBy: user.uuid || String(user.id),
        ...defaultPermissions
      };

      if (allowedPermissions && typeof allowedPermissions === 'object') {
        const validLevels = ['NONE', 'VIEW', 'EDIT_PIN', 'EDIT_PIN_READ', 'FULL'];
        const fields = Object.keys(defaultPermissions);
        fields.forEach(field => {
          if (allowedPermissions[field] !== undefined) {
            if (field === 'canToggleLiveMode') {
              permsData[field] = !!allowedPermissions[field];
            } else if (validLevels.includes(allowedPermissions[field])) {
              permsData[field] = allowedPermissions[field];
            }
          }
        });
      }

      const permissions = await tx.branchPermissions.create({
        data: permsData
      });

      return { branch, manager: managerUser, permissions };
    });

    // 6. Audit Logging
    await auditService.log({
      action: 'BRANCH_CREATED',
      userId: user.id,
      userRole: user.role,
      metadata: { branchId: result.branch.id, branchName: result.branch.name, managerId: result.manager.id },
      req
    });

    const io = require('../socket').getIO();
    io?.emit('branch:updated');

    return response.success(res, {
      message: 'تم إنشاء الفرع ومدير الفرع بنجاح وتعيين الصلاحيات',
      data: {
        branchId: result.branch.id,
        name: result.branch.name,
        code: result.branch.code,
        managerId: result.manager.id,
        managerEmail
      }
    });

  } catch (error) {
    logger.error('Create branch error', { error: error.message });
    return response.error(res, 'حدث خطأ أثناء إنشاء الفرع ومدير الفرع', 'SERVER_ERROR', 500);
  }
};

/**
 * 🔒 Update Branch Permissions (Admin Only)
 */
exports.updateBranchPermissions = async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params; // branchId
    const { allowedPermissions } = req.body;

    if (user.role?.toUpperCase() !== 'ADMIN') {
      return response.error(res, 'غير مصرح لك بتعديل صلاحيات الفروع', 'FORBIDDEN', 403);
    }

    if (!allowedPermissions || typeof allowedPermissions !== 'object') {
      return response.error(res, 'بيانات غير صالحة', 'INVALID_PAYLOAD', 400);
    }

    const branch = await prisma.branch.findFirst({ where: { id, isDeleted: false } });
    if (!branch) {
      return response.error(res, 'الفرع غير موجود', 'BRANCH_NOT_FOUND', 404);
    }

    // 1. Transaction to update permissions and invalidate user permissionVersions
    await prisma.$transaction(async (tx) => {
      const validLevels = ['NONE', 'VIEW', 'EDIT_PIN', 'EDIT_PIN_READ', 'FULL'];
      const updateData = {};
      const fields = [
        'liveOrders', 'manageOrders', 'menu', 'notifications', 'reviews',
        'loyalty', 'rewardsStore', 'advancedAnalytics', 'financials',
        'deliveryZones', 'auditLog', 'settings', 'canToggleLiveMode', 'canModifyWorkHours'
      ];

      fields.forEach(field => {
        if (allowedPermissions[field] !== undefined) {
          if (field === 'canToggleLiveMode') {
            updateData[field] = !!allowedPermissions[field];
          } else if (validLevels.includes(allowedPermissions[field])) {
            updateData[field] = allowedPermissions[field];
          }
        }
      });

      updateData.updatedBy = user.uuid || String(user.id);

      await tx.branchPermissions.upsert({
        where: { branchId: id },
        update: updateData,
        create: {
          branchId: id,
          ...updateData
        }
      });

      // 2. Increment permissionVersion of all users in this branch to force token refresh
      await tx.user.updateMany({
        where: { branchId: id },
        data: { permissionVersion: { increment: 1 } }
      });
    });

    // 3. Clear Redis permission matrix cache for this branch
    const cacheKey = `branch:${id}:permissions_matrix`;
    await redis.del(cacheKey).catch(() => {});

    // 4. Invalidate user permissions in SecurityPolicyService for all users of this branch
    const SecurityPolicyService = require('../services/securityPolicyService');
    const branchUsers = await prisma.user.findMany({
      where: { branchId: id },
      select: { uuid: true }
    });

    for (const u of branchUsers) {
      await SecurityPolicyService.invalidateUserPermissions(u.uuid).catch(() => {});
    }

    // 5. Audit Log
    await auditService.log({
      action: 'BRANCH_PERMISSIONS_UPDATED',
      userId: user.id,
      userRole: user.role,
      metadata: { branchId: id, allowedPermissions },
      req
    });

    return response.success(res, { message: 'تم تحديث صلاحيات الفرع بنجاح وتفعيلها لجميع المستخدمين' });
  } catch (error) {
    logger.error('Update branch permissions error', { error: error.message });
    return response.error(res, 'حدث خطأ أثناء تحديث صلاحيات الفرع', 'SERVER_ERROR', 500);
  }
};

/**
 * 🔒 Get Branch Permissions (Admin or Branch Manager)
 */
exports.getBranchPermissions = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Only Admin or Branch Manager for their own branch
    if (user.role?.toUpperCase() !== 'ADMIN' && user.branchId !== id) {
      return response.error(res, 'غير مصرح لك بطلب هذه البيانات', 'FORBIDDEN', 403);
    }

    const permissions = await prisma.branchPermissions.findUnique({
      where: { branchId: id }
    });

    if (!permissions) {
      return res.json({
        success: true,
        data: {
          liveOrders: 'FULL',
          manageOrders: 'FULL',
          menu: 'FULL',
          notifications: 'FULL',
          reviews: 'VIEW',
          loyalty: 'VIEW',
          rewardsStore: 'NONE',
          advancedAnalytics: 'VIEW',
          financials: 'VIEW',
          deliveryZones: 'EDIT_PIN',
          auditLog: 'VIEW',
          settings: 'EDIT_PIN',
          canToggleLiveMode: false,
          canModifyWorkHours: 'EDIT_PIN'
        }
      });
    }

    return res.json({ success: true, data: permissions });
  } catch (error) {
    logger.error('Get branch permissions error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

/**
 * 🔑 Verify Manager PIN (and cache state for 5 minutes)
 */
exports.verifyManagerPin = async (req, res) => {
  try {
    const { managerPin } = req.body;
    const user = req.user;
    const branchId = user.branchId;

    if (!branchId) {
      return response.error(res, 'لم يتم العثور على فرع مرتبط بهذا الحساب', 'BRANCH_NOT_FOUND', 400);
    }

    if (!managerPin || !/^\d{4}$/.test(managerPin)) {
      return response.error(res, 'يجب أن يكون رقم PIN للمدير مكوناً من 4 أرقام', 'INVALID_PIN', 400);
    }

    // Rate Limiter for PIN Attempts (Max 5 attempts in 15 mins)
    const rateLimitKey = `pin:attempts:${branchId}`;
    const attempts = await redis.incr(rateLimitKey).catch(() => 0);
    if (attempts === 1) {
      await redis.expire(rateLimitKey, 900).catch(() => {});
    }

    if (attempts > 5) {
      return response.error(res, 'تم تجاوز عدد محاولات الـ PIN المسموحة، حاول مجدداً بعد 15 دقيقة', 'PIN_LOCKED', 429);
    }

    const manager = await prisma.user.findFirst({
      where: {
        branchId,
        role: 'BRANCH_MANAGER',
        isActive: true
      }
    });

    if (!manager || !manager.pinHash) {
      return response.error(res, 'لم يتم تعيين رقم PIN لمدير هذا الفرع بعد', 'PIN_NOT_CONFIGURED', 400);
    }

    const isPinValid = await bcrypt.compare(managerPin, manager.pinHash);
    if (!isPinValid) {
      return response.error(res, 'رقم PIN غير صحيح', 'INVALID_PIN', 401);
    }

    // Reset rate limits on success
    await redis.del(rateLimitKey).catch(() => {});

    // Cache successful PIN verification state for 5 minutes in Redis
    const pinCacheKey = `branch:${branchId}:user:${user.id}:manager_pin_verified`;
    await redis.setex(pinCacheKey, 300, 'true').catch(() => {});

    return response.success(res, { message: 'تم التحقق من الـ PIN بنجاح، تم إلغاء القفل لـ 5 دقائق' });
  } catch (error) {
    logger.error('Verify manager PIN error', { error: error.message });
    return response.error(res, 'حدث خطأ أثناء التحقق من الـ PIN', 'SERVER_ERROR', 500);
  }
};

/**
 * 📱 Get Active & Ordered Branches for App Consumer
 */
exports.getActiveBranchesForApp = async (req, res) => {
  try {
    const branches = await prisma.branch.findMany({
      where: {
        isActive: true,
        isDeleted: false,
        visibleInApp: true
      },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        appDisplayOrder: true
      },
      orderBy: { appDisplayOrder: 'asc' }
    });

    // Decrypt phone numbers if they are encrypted
    const { decrypt } = require('../utils/crypto');
    const decryptedBranches = branches.map(b => {
      let phone = b.phone;
      if (phone) {
        try {
          phone = decrypt(phone);
        } catch (e) {
          // Fallback if not encrypted
        }
      }
      return {
        ...b,
        phone
      };
    });

    return res.json({ success: true, data: decryptedBranches });
  } catch (error) {
    logger.error('Get active branches error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

/**
 * 📝 Update Branch Details
 */
exports.updateBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, phone } = req.body;
    const user = req.user;

    const branch = await prisma.branch.update({
      where: { id },
      data: { name, address, phone }
    });

    await auditService.log({
      action: 'BRANCH_UPDATED',
      userId: user.id,
      userRole: user.role,
      metadata: { branchId: id, name },
      req
    });

    const io = require('../socket').getIO();
    io?.emit('branch:updated');

    return response.success(res, { message: 'تم تحديث الفرع بنجاح', data: branch });
  } catch (error) {
    logger.error('Update branch error', { error: error.message });
    return response.error(res, 'فشل في تحديث الفرع', 'SERVER_ERROR', 500);
  }
};

/**
 * 🔄 Toggle Branch Status
 */
exports.toggleBranchStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    const user = req.user;

    const branch = await prisma.branch.update({
      where: { id },
      data: { isActive }
    });

    await auditService.log({
      action: 'BRANCH_STATUS_TOGGLED',
      userId: user.id,
      userRole: user.role,
      metadata: { branchId: id, isActive },
      req
    });

    const io = require('../socket').getIO();
    io?.emit('branch:updated');

    return response.success(res, { message: 'تم تحديث حالة الفرع بنجاح', data: branch });
  } catch (error) {
    logger.error('Toggle branch status error', { error: error.message });
    return response.error(res, 'فشل في تحديث حالة الفرع', 'SERVER_ERROR', 500);
  }
};


