const happyHourService = require('../services/happyHourService');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

/**
 * 📊 Get Current Happy Hour Status for a Branch
 */
exports.getBranchStatus = async (req, res) => {
  try {
    const { branchId } = req.params;
    const status = await happyHourService.redis.get(`happyhour:active:${branchId}`);
    
    res.json({
      success: true,
      data: status ? JSON.parse(status) : null,
      isActive: !!status
    });
  } catch (err) {
    logger.error('Failed to get HH status', { error: err.message });
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * 📋 Get Operational Stats for Admin
 */
exports.getAdminStats = async (req, res) => {
  try {
    const stats = {
      activeConfigs: await prisma.happyHour.count({ where: { status: 'active' } }),
      runningCronJobs: happyHourService.cronJobs.size,
      instanceId: happyHourService.instanceId,
      timestamp: new Date().toISOString()
    };

    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * 🔄 Force Reload Configs (Global Broadcast)
 */
exports.reloadConfigs = async (req, res) => {
  try {
    await happyHourService.pubSub.publish('happyhour:reload', JSON.stringify({
      requestedBy: req.user.id,
      timestamp: Date.now()
    }));

    res.json({ success: true, message: 'Reload signal broadcasted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * ➕ Create New Happy Hour
 */
exports.createConfig = async (req, res) => {
  try {
    const { branchId, dayOfWeek, startTime, endTime, discount, description } = req.body;

    const config = await prisma.happyHour.create({
      data: { branchId, dayOfWeek, startTime, endTime, discount, description }
    });

    // Trigger reload
    await happyHourService.pubSub.publish('happyhour:reload', JSON.stringify({ configId: config.id }));

    res.status(201).json({ success: true, data: config });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
