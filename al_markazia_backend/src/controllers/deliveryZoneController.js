const DeliveryZoneService = require('../services/deliveryZoneService');
const logger = require('../utils/logger');

/**
 * Professional Delivery Zone Controller
 * REST API for managing delivery areas
 */
exports.getAllZones = async (req, res) => {
  try {
    const zones = await DeliveryZoneService.getAllZones();
    res.json({ success: true, data: zones });
  } catch (error) {
    logger.error('Fetch all zones failed', { error: error.message });
    res.status(500).json({ success: false, error: 'فشل في جلب مناطق التوصيل' });
  }
};

exports.getActiveZones = async (req, res) => {
  try {
    // Note: Caching is handled at the network level (if any) or app level
    const zones = await DeliveryZoneService.getActiveZones();
    res.json({ success: true, data: zones });
  } catch (error) {
    logger.error('Fetch active zones failed', { error: error.message });
    res.status(500).json({ success: false, error: 'فشل في جلب المناطق المتاحة' });
  }
};

exports.createZone = async (req, res) => {
  try {
    const zone = await DeliveryZoneService.createZone(req.body, req.user?.email || 'admin');
    res.status(201).json({ success: true, data: zone });
  } catch (error) {
    logger.error('Create zone failed', { error: error.message });
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.updateZone = async (req, res) => {
  try {
    const { id } = req.params;
    const zone = await DeliveryZoneService.updateZone(id, req.body, req.user?.email || 'admin');
    res.json({ success: true, data: zone });
  } catch (error) {
    logger.error('Update zone failed', { id, error: error.message });
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.deleteZone = async (req, res) => {
  try {
    const { id } = req.params;
    await DeliveryZoneService.deleteZone(id, req.user?.email || 'admin');
    res.json({ success: true, message: 'تم حذف المنطقة بنجاح' });
  } catch (error) {
    logger.error('Delete zone failed', { id, error: error.message });
    res.status(400).json({ success: false, error: error.message });
  }
};
