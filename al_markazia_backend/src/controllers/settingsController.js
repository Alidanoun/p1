
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

exports.getSettings = async (req, res) => {
  try {
    const settings = await prisma.systemSettings.findMany();
    // Convert array to object for easier use on frontend
    const settingsObj = settings.reduce((acc, curr) => {
      acc[curr.key] = curr.value;
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
    
    // 🛡️ [CRITICAL] Business Rule Validation
    if (settings.deliveryFee !== undefined) {
      const fee = parseFloat(settings.deliveryFee);
      if (isNaN(fee) || fee < 0) {
        return res.status(400).json({ error: 'رسوم التوصيل يجب أن تكون رقماً صالحاً وغير سالب' });
      }
    }

    if (settings.minOrderValue !== undefined) {
      const minVal = parseFloat(settings.minOrderValue);
      if (isNaN(minVal) || minVal < 0) {
        return res.status(400).json({ error: 'الحد الأدنى للطلب يجب أن يكون رقماً صالحاً' });
      }
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
