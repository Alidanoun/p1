
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
