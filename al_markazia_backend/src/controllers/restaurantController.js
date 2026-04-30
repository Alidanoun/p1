const workingHoursService = require('../services/workingHoursService');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { DateTime } = require('luxon');
const bcrypt = require('bcrypt');
const eventBus = require('../events/eventBus');

/**
 * 🏢 RestaurantController
 * Handles public status and administrative restaurant settings.
 */
const getStatus = async (req, res) => {
  try {
    const status = await workingHoursService.getStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('[RestaurantController] Error getting status', { error: error.message });
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
};

const getSchedule = async (req, res) => {
  try {
    const [settings, schedule] = await Promise.all([
      prisma.restaurantSettings.findFirst({ where: { id: 1 } }),
      prisma.workingHour.findMany({ orderBy: { dayOfWeek: 'asc' } })
    ]);

    res.json({
      success: true,
      data: { settings, schedule }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
};

const updateSchedule = async (req, res) => {
  try {
    const { schedule, settings } = req.body;

    // 1. Update Settings if provided
    if (settings) {
      await prisma.restaurantSettings.upsert({
        where: { id: 1 },
        update: settings,
        create: { id: 1, ...settings }
      });
    }

    // 2. Update Schedule items if provided
    if (schedule && Array.isArray(schedule)) {
      for (const day of schedule) {
        await prisma.workingHour.upsert({
          where: { dayOfWeek: day.dayOfWeek },
          update: {
            openTime: day.openTime,
            closeTime: day.closeTime,
            isClosed: day.isClosed
          },
          create: {
            dayOfWeek: day.dayOfWeek,
            openTime: day.openTime,
            closeTime: day.closeTime,
            isClosed: day.isClosed
          }
        });
      }
    }

    // 3. Invalidate Cache
    workingHoursService.invalidateCache();

    res.json({
      success: true,
      message: 'تم تحديث مواعيد العمل بنجاح'
    });
  } catch (error) {
    logger.error('[RestaurantController] Error updating schedule', { error: error.message });
    res.status(500).json({ success: false, error: 'UPDATE_FAILED' });
  }
};

const toggleEmergencyClose = async (req, res) => {
  try {
    const { isOpen, type, durationMinutes, password, reason } = req.body;
    const adminId = req.user.id;

    logger.info('[RestaurantController] Emergency toggle request', { isOpen, type, adminId });

    // 1. Security Check: Verify Admin Password ONLY if closing for the day
    const isDayClose = !isOpen && type === 'day';
    if (isDayClose) {
      if (!password) return res.status(400).json({ success: false, error: 'مطلوب كلمة مرور المدير' });
      const admin = await prisma.user.findUnique({ where: { uuid: adminId } });
      if (!admin) return res.status(404).json({ success: false, error: 'المسؤول غير موجود' });
      
      const isPasswordValid = await bcrypt.compare(password, admin.password);
      if (!isPasswordValid) {
        return res.status(401).json({ success: false, error: 'كلمة المرور غير صحيحة' });
      }
    }

    const settings = await prisma.restaurantSettings.findFirst({ where: { id: 1 } });
    if (!settings) throw new Error('Restaurant settings not found');
    
    const now = DateTime.now().setZone(settings.timezone);

    let reopenAt = null;

    if (!isOpen) {
      // Logic for CLOSING
      if (type === 'timed') {
        reopenAt = now.plus({ minutes: parseInt(durationMinutes) || 30 }).toJSDate();
      } else if (type === 'day') {
        // End of today (23:59:59)
        reopenAt = now.endOf('day').toJSDate();
      }
    }

    await prisma.restaurantSettings.update({
      where: { id: 1 },
      data: {
        isEmergencyClosed: !isOpen,
        closureReason: reason || (isOpen ? null : 'إغلاق طارئ مؤقت'),
        reopenAt: reopenAt
      }
    });

    workingHoursService.invalidateCache();

    if (isOpen) {
      eventBus.emitSafe('RESTAURANT_OPENED');
    }

    res.json({
      success: true,
      message: isOpen ? 'تم فتح المطعم بنجاح' : 'تم إغلاق المطعم بنجاح',
      reopenAt: reopenAt
    });
  } catch (error) {
    logger.error('[RestaurantController] Emergency toggle failed', { 
      error: error.message,
      stack: error.stack 
    });
    res.status(500).json({ success: false, error: error.message || 'INTERNAL_ERROR' });
  }
};

const subscribeToReopen = async (req, res) => {
  try {
    const { fcmToken, nextOpenAt } = req.body;
    const userId = req.user?.id;

    if (!fcmToken || !nextOpenAt) {
      return res.status(400).json({ success: false, error: 'MISSING_DATA' });
    }

    // Verify restaurant is actually closed
    const status = await workingHoursService.getStatus();
    if (status.isOpen) {
      return res.status(400).json({ success: false, error: 'RESTAURANT_ALREADY_OPEN' });
    }

    await prisma.restaurantSubscription.create({
      data: {
        userId,
        fcmToken,
        targetTime: new Date(nextOpenAt),
      }
    });

    res.json({ success: true, message: 'SUBSCRIPTION_SUCCESS' });
  } catch (error) {
    logger.error('[RestaurantController] Error subscribing to reopen', { error: error.message });
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
};

module.exports = {
  getStatus,
  getSchedule,
  updateSchedule,
  toggleEmergencyClose,
  subscribeToReopen
};
