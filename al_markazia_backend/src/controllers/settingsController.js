const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const SecurityPolicyService = require('../services/securityPolicyService');
const { decrypt, hashBlind } = require('../utils/crypto');
const { validatePasswordStrength } = require('../utils/security');
const { BCRYPT_ROUNDS } = require('../config/secrets');
const auditService = require('../services/auditService');

const BOOLEAN_KEYS = ['notificationsEnabled', 'autoAcceptOrders'];

exports.getSettings = async (req, res) => {
  try {
    const settings = await prisma.systemSettings.findMany();
    // Convert array to object for easier use on frontend
    const settingsObj = settings.reduce((acc, curr) => {
      let val = curr.value;
      if (BOOLEAN_KEYS.includes(curr.key)) {
        val = val === 'true';
      }
      acc[curr.key] = val;
      return acc;
    }, {});
    
    res.json(settingsObj);
  } catch (error) {
    logger.error('Get settings error', { error: error.message });
    res.status(500).json({ error: 'فشل في جلب الإعدادات' });
  }
};

exports.getAuditLogs = async (req, res) => {
  try {
    const logs = await prisma.systemAuditLog.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: logs });
  } catch (error) {
    logger.error('Get audit logs error', { error: error.message });
    res.status(500).json({ error: 'فشل في جلب سجل النشاطات' });
  }
};

exports.updateAdminCredentials = async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body;
    const adminId = req.user.id;

    if (!adminId) return res.status(401).json({ error: 'Unauthorized' });

    const admin = await prisma.user.findUnique({ where: { uuid: adminId } });
    if (!admin) return res.status(404).json({ error: 'Admin not found' });

    // Validate current password
    if (currentPassword) {
      const isValid = await bcrypt.compare(currentPassword, admin.password);
      if (!isValid) return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    } else if (newPassword || (email && email !== decrypt(admin.email))) {
      return res.status(401).json({ error: 'يجب إدخال كلمة المرور الحالية لتأكيد التغييرات' });
    }

    const updateData = {};
    if (email && email !== admin.email) {
      // Check if email is already taken
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) return res.status(400).json({ error: 'هذا البريد الإلكتروني مستخدم مسبقاً' });
      updateData.email = email;
    }

    if (newPassword) {
      const validation = validatePasswordStrength(newPassword);
      if (!validation.isValid) return res.status(400).json({ error: validation.message });
      updateData.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { uuid: adminId },
        data: { 
          ...updateData,
          authVersion: { increment: 1 } // 🔥 Invalidate all old sessions on credential change
        }
      });

      // Log the change
      await auditService.log({
        userId: adminId,
        userRole: admin.role,
        action: 'UPDATE_ADMIN_CREDENTIALS',
        metadata: { emailChanged: !!updateData.email, passwordChanged: !!updateData.password },
        req
      });
      // 🛡️ [SEC-FIX] Invalidate permissions cache immediately
      await SecurityPolicyService.invalidateUserPermissions(adminId);
    }

    res.json({ success: true, message: 'تم تحديث بيانات الدخول بنجاح' });
  } catch (error) {
    logger.error('Update credentials error', { error: error.message });
    res.status(500).json({ error: 'فشل في تحديث بيانات الدخول' });
  }
};

exports.updateBranchCredentials = async (req, res) => {
  try {
    const { branchId, newPassword, email, pin } = req.body;
    const adminId = req.user.id;

    if (!adminId || req.user.role?.toLowerCase() !== 'admin') return res.status(401).json({ error: 'Unauthorized' });
    if (!branchId || (!newPassword && !pin)) return res.status(400).json({ error: 'الفرع وكلمة المرور الجديدة أو الرمز مطلوبان' });

    // Find the branch manager
    const manager = await prisma.user.findFirst({
      where: { 
        branchId, 
        role: { in: ['MANAGER', 'BRANCH_MANAGER'] } 
      }
    });

    if (!manager) return res.status(404).json({ error: 'لم يتم العثور على مدير لهذا الفرع' });

    const updateData = {};
    if (email && email !== decrypt(manager.email)) {
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) return res.status(400).json({ error: 'هذا البريد الإلكتروني مستخدم مسبقاً' });
      updateData.email = email;
    }

    if (newPassword) {
      const validation = validatePasswordStrength(newPassword);
      if (!validation.isValid) return res.status(400).json({ error: validation.message });
      updateData.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    }

    if (pin && pin.length === 4) {
      updateData.pinHash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
      updateData.plainPin = pin;
    }

    await prisma.user.update({
      where: { id: manager.id },
      data: {
        ...updateData,
        authVersion: { increment: 1 }, // 🔥 Force relogin if password changed
        permissionVersion: { increment: 1 } // 🔥 Refresh permissions
      }
    });

    // Log the change
    await auditService.log({
      userId: adminId,
      userRole: 'ADMIN',
      action: 'UPDATE_BRANCH_CREDENTIALS',
      metadata: { branchId, managerId: manager.id, emailChanged: !!updateData.email },
      req
    });

    // 🛡️ [SEC-FIX] Invalidate permissions cache immediately
    await SecurityPolicyService.invalidateUserPermissions(manager.uuid);

    res.json({ success: true, message: 'تم تحديث بيانات الفرع بنجاح' });
  } catch (error) {
    logger.error('Update branch credentials error', { error: error.message });
    res.status(500).json({ error: 'فشل في تحديث بيانات الفرع' });
  }
};

exports.updateSetting = async (req, res) => {
  try {
    const { key, value } = req.body;
    
    if (!key) return res.status(400).json({ error: 'Key is required' });

    const setting = await prisma.systemSettings.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value) }
    });

    res.json(setting);
  } catch (error) {
    logger.error('Update setting error', { error: error.message, key: req.body?.key });
    res.status(500).json({ error: 'فشل في تحديث الإعداد' });
  }
};

/**
 * 🛠️ Update Advanced System Config (JSON Blocks)
 */
exports.updateAdvancedConfig = async (req, res) => {
  try {
    const { type, data } = req.body; // type: 'business' | 'security'
    const configService = require('../services/configService');

    // 🛡️ Validate taxRate if provided (must be between 0 and 1)
    if (type === 'business' && data.taxRate !== undefined) {
      const taxRate = parseFloat(data.taxRate);
      if (isNaN(taxRate) || taxRate < 0 || taxRate > 1) {
        return res.status(400).json({ error: 'نسبة الضريبة يجب أن تكون بين 0 و 1 (مثال: 0.16 لضريبة 16%)' });
      }
      data.taxRate = taxRate; // Ensure it's stored as a number
    }

    // 🎯 Target the Master Config record
    const masterConfig = await prisma.systemSettings.upsert({
      where: { key: 'system_config' },
      update: {},
      create: { key: 'system_config', value: 'active' }
    });

    const updateField = type === 'business' ? 'businessConfig' : 'securityConfig';
    const oldConfig = masterConfig[updateField] || {};

    const updated = await prisma.systemSettings.update({
      where: { id: masterConfig.id },
      data: {
        [updateField]: { ...oldConfig, ...data }
      }
    });

    // 📝 Log to System Audit
    await auditService.log({
      userId: req.user.id,
      userRole: req.user.role,
      action: `UPDATE_${type.toUpperCase()}_CONFIG`,
      entityType: 'SystemSettings',
      entityId: masterConfig.id.toString(),
      metadata: { diff: data },
      req
    });

    // 🏆 Trigger Automatic Bestsellers update if toggled ON
    if (type === 'business' && data.autoFeaturedMode === true) {
      const bestsellerService = require('../services/bestsellerService');
      // Fire and forget, don't await so the request doesn't hang
      bestsellerService.updateBestsellers().catch(err => {
        logger.error('Failed to trigger updateBestsellers from config change', { error: err.message });
      });
    }

    // ♻️ Refresh Cache
    await configService.refreshCache();

    res.json({ success: true, data: updated[updateField] });
  } catch (error) {
    logger.error('Update advanced config error', { error: error.message });
    res.status(500).json({ error: 'Failed to update configuration' });
  }
};

exports.updateBulkSettings = async (req, res) => {
  try {
    const { settings, lastFetchTime } = req.body.settings ? req.body : { settings: req.body, lastFetchTime: 0 };
    const priceRegex = /^\d+(\.\d{1,2})?$/;
    
    // 🛡️ Optimistic Locking Guard
    if (lastFetchTime) {
      const latestSetting = await prisma.systemSettings.findFirst({
        orderBy: { updatedAt: 'desc' }
      });
      if (latestSetting && new Date(latestSetting.updatedAt).getTime() > lastFetchTime) {
        return res.status(409).json({ error: 'CONCURRENCY_CONFLICT', message: 'تم تعديل الإعدادات من قبل شخص آخر. يرجى تحديث الصفحة والمحاولة مرة أخرى.' });
      }
    }
    
    // 🛡️ [CRITICAL] Strict Validation Phase
    const validationErrors = [];
    
    if (settings.deliveryFee !== undefined && !priceRegex.test(String(settings.deliveryFee))) {
      validationErrors.push('رسوم التوصيل يجب أن تكون رقماً صالحاً (مثلاً: 2.50)');
    }

    if (settings.minOrderValue !== undefined && !priceRegex.test(String(settings.minOrderValue))) {
      validationErrors.push('الحد الأدنى للطلب يجب أن يكون رقماً صالحاً');
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors[0], details: validationErrors });
    }

    // 🚀 Atomic Multi-Update
    const operations = Object.entries(settings)
      .filter(([key, value]) => {
        // Skip huge values (like Base64 logos) to prevent DB clogging
        // These should be handled via a dedicated upload endpoint
        if (typeof value === 'string' && value.length > 50000) {
          logger.warn(`Skipping large setting key: ${key} (Length: ${value.length})`);
          return false;
        }
        return true;
      })
      .map(([key, value]) => {
        return prisma.systemSettings.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) }
        });
      });

    await prisma.$transaction(operations);

    // ♻️ Invalidate Cache
    const redis = require('../lib/redis');
    await redis.del('system:settings');
    await redis.del('system:config'); // <-- Added this
    await redis.del('system:announcement'); // <-- Added this
    const memoryCache = require('../lib/memoryCache');
    memoryCache.del('system:settings');
    memoryCache.del('system:config'); // <-- Added this

    // 📝 Add System Audit Log
    try {
      await auditService.log({
        userId: req.user?.id || req.user?.uuid,
        userRole: req.user?.role || 'admin',
        action: 'UPDATE_BULK_SETTINGS',
        metadata: { updatedKeys: Object.keys(settings).filter(k => settings[k]?.length < 1000) },
        req
      });
    } catch (auditErr) {
      logger.error('Failed to write system audit log', { error: auditErr.message });
    }

    logger.info('System settings updated bulkly', { keys: Object.keys(settings), admin: req.user.id });
    res.json({ success: true, message: 'تم تحديث الإعدادات بنجاح' });
  } catch (error) {
    logger.error('Update bulk settings error', { error: error.message });
    res.status(500).json({ error: 'فشل في تحديث الإعدادات' });
  }
};
