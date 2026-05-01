const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

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
    const adminId = req.user.uuid;

    if (!adminId) return res.status(401).json({ error: 'Unauthorized' });

    const admin = await prisma.user.findUnique({ where: { uuid: adminId } });
    if (!admin) return res.status(404).json({ error: 'Admin not found' });

    // Validate current password
    if (currentPassword) {
      const isValid = await bcrypt.compare(currentPassword, admin.password);
      if (!isValid) return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    } else if (newPassword || email !== admin.email) {
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
      if (newPassword.length < 6) return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
      updateData.password = await bcrypt.hash(newPassword, 10);
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { uuid: adminId },
        data: updateData
      });

      // Log the change
      await prisma.systemAuditLog.create({
        data: {
          userId: adminId,
          userRole: admin.role,
          action: 'UPDATE_ADMIN_CREDENTIALS',
          ip: req.ip,
          metadata: { emailChanged: !!updateData.email, passwordChanged: !!updateData.password }
        }
      });
    }

    res.json({ success: true, message: 'تم تحديث بيانات الدخول بنجاح' });
  } catch (error) {
    logger.error('Update credentials error', { error: error.message });
    res.status(500).json({ error: 'فشل في تحديث بيانات الدخول' });
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

exports.updateBulkSettings = async (req, res) => {
  try {
    const settings = req.body;
    const priceRegex = /^\d+(\.\d{1,2})?$/;
    
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
    const operations = Object.entries(settings).map(([key, value]) => {
      return prisma.systemSettings.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) }
      });
    });

    await prisma.$transaction(operations);

    // 📝 Add System Audit Log
    try {
      await prisma.systemAuditLog.create({
        data: {
          userId: req.user?.uuid || req.user?.id?.toString(),
          userRole: req.user?.role || 'admin',
          action: 'UPDATE_BULK_SETTINGS',
          ip: req.ip,
          metadata: { updatedKeys: Object.keys(settings) }
        }
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
