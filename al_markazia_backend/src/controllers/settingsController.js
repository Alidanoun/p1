
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

    logger.info('System settings updated bulkly', { keys: Object.keys(settings), admin: req.user.id });
    res.json({ success: true, message: 'تم تحديث الإعدادات بنجاح' });
  } catch (error) {
    logger.error('Update bulk settings error', { error: error.message });
    res.status(500).json({ error: 'فشل في تحديث الإعدادات' });
  }
};
