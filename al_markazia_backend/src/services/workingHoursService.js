const { DateTime } = require('luxon');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const nodeCache = require('../lib/memoryCache');

/**
 * 🥡 WorkingHoursService
 * Manages restaurant scheduling, emergency closures, and grace periods.
 * Uses Luxon for precise timezone-aware calculations.
 */
class WorkingHoursService {
  constructor() {
    this.CACHE_KEY = 'restaurant_status';
    this.CACHE_TTL = 60; // 60 seconds
  }

  /**
   * 📡 Get Current Restaurant Status
   * Returns whether the restaurant is open, next opening time, and closure reason.
   */
  async getStatus() {
    try {
      // 1. Check Cache
      const cachedStatus = nodeCache.get(this.CACHE_KEY);
      if (cachedStatus) return cachedStatus;

      // 2. Fetch Settings & Schedule
      const [settings, schedule] = await Promise.all([
        prisma.restaurantSettings.findFirst({ where: { id: 1 } }),
        prisma.workingHour.findMany()
      ]);

      if (!settings) {
        logger.error('[WorkingHours] Restaurant settings not found. Defaulting to OPEN.');
        return { isOpen: true, message: 'Settings missing' };
      }

      const now = DateTime.now().setZone(settings.timezone);

      // 3. Check Emergency Closure (Hard Close)
      if (settings.isEmergencyClosed) {
        // 🛡️ Auto-Reopen Logic: Check if timed closure has expired
        const hasReopened = settings.reopenAt && now >= DateTime.fromJSDate(settings.reopenAt).setZone(settings.timezone);
        
        if (!hasReopened) {
          const status = {
            isOpen: false,
            isEmergency: true,
            closureType: settings.reopenAt ? 'temporary' : 'emergency',
            reason: settings.closureReason || 'المطعم مغلق حالياً لأسباب فنية',
            nextOpenAt: settings.reopenAt ? DateTime.fromJSDate(settings.reopenAt).toISO() : null
          };
          nodeCache.set(this.CACHE_KEY, status, this.CACHE_TTL);
          return status;
        } else {
          logger.info('[WorkingHours] Emergency closure expired. Reopening automatically.');
        }
      }

      const dayOfWeek = now.weekday === 7 ? 0 : now.weekday; // Luxon 1-7 (Mon-Sun) to Prisma 0-6 (Sun-Sat)
      const todaySchedule = schedule.find(s => s.dayOfWeek === dayOfWeek);

      if (!todaySchedule || todaySchedule.isClosed) {
        const status = await this._getClosedStatus(now, schedule, settings);
        nodeCache.set(this.CACHE_KEY, status, this.CACHE_TTL);
        return status;
      }

      // 4. Calculate Opening/Closing Times
      const [openH, openM] = todaySchedule.openTime.split(':').map(Number);
      const [closeH, closeM] = todaySchedule.closeTime.split(':').map(Number);

      let openTime = now.set({ hour: openH, minute: openM, second: 0, millisecond: 0 });
      let closeTime = now.set({ hour: closeH, minute: closeM, second: 0, millisecond: 0 });

      if (closeTime < openTime) {
        if (now < closeTime) {
          openTime = openTime.minus({ days: 1 });
        } else {
          closeTime = closeTime.plus({ days: 1 });
        }
      }

      const gracePeriodMs = settings.lastOrderMinutesBeforeClose * 60 * 1000;
      const effectiveCloseTime = closeTime.minus({ milliseconds: gracePeriodMs });

      const isOpen = now >= openTime && now < effectiveCloseTime;

      let status;
      if (isOpen) {
        status = {
          isOpen: true,
          closingAt: closeTime.toISO(),
          gracePeriodAt: effectiveCloseTime.toISO()
        };
      } else {
        status = await this._getClosedStatus(now, schedule, settings);
      }

      nodeCache.set(this.CACHE_KEY, status, this.CACHE_TTL);
      return status;
    } catch (error) {
      logger.error('[WorkingHours] Error calculating status', { error: error.message });
      return { isOpen: true, error: 'TRANSITION_FAILURE' };
    }
  }

  async ensureOpen() {
    const status = await this.getStatus();
    if (!status.isOpen) {
      throw new Error(status.reason || 'المطعم مغلق حالياً، لا يمكن استقبال طلبات جديدة');
    }
    return true;
  }

  async _getClosedStatus(now, schedule, settings) {
    const isEmergency = settings.isEmergencyClosed && !(settings.reopenAt && now >= DateTime.fromJSDate(settings.reopenAt).setZone(settings.timezone));
    
    let reason = 'المطعم مغلق حالياً. نعتذر عن استقبال الطلبات.';
    let reasonEn = 'The restaurant is currently closed. We apologize for not receiving orders.';
    let nextOpenAt = null;
    let closureType = 'end_of_day';

    if (isEmergency) {
      if (settings.reopenAt) {
        closureType = 'temporary';
        const openAt = DateTime.fromJSDate(settings.reopenAt).setZone(settings.timezone);
        const diff = openAt.diff(now, ['minutes', 'seconds']).toObject();
        const mins = Math.max(0, Math.floor(diff.minutes || 0));
        reason = `نظراً لضغط الطلبات، تم إيقاف الخدمة مؤقتاً لنضمن لكم أفضل جودة. سنعود خلال ${mins} دقيقة.`;
        reasonEn = `Due to high demand, service has been temporarily paused to ensure the best quality. We will return in ${mins} minutes.`;
        nextOpenAt = openAt.toISO();
      } else {
        closureType = 'emergency';
        reason = "نعتذر عن الإزعاج، المطعم مغلق حالياً لأعمال صيانة وتحسينات لضمان أفضل جودة لكم. سنفتح قريباً!";
        reasonEn = "We apologize for the inconvenience, the restaurant is currently closed for maintenance and improvements to ensure the best quality for you. We will open soon!";
      }
    } else {
      closureType = 'end_of_day';
      reason = "نعتذر منك، مطعم المركزية مغلق حالياً. نسعد باستقبال طلباتك يومياً من الساعة 9:00 صباحاً وحتى 11:00 مساءً.";
      reasonEn = "We apologize, Al-Markazia is currently closed. We are happy to receive your orders daily from 9:00 AM to 11:00 PM.";
      
      for (let i = 0; i < 7; i++) {
        const checkDate = now.plus({ days: i });
        const checkDay = checkDate.weekday === 7 ? 0 : checkDate.weekday;
        const dayData = schedule.find(s => s.dayOfWeek === checkDay);
        
        if (dayData && !dayData.isClosed) {
          const [h, m] = dayData.openTime.split(':').map(Number);
          const opening = checkDate.set({ hour: h, minute: m, second: 0, millisecond: 0 });
          
          if (opening > now) {
            nextOpenAt = opening.toISO();
            break;
          }
        }
      }
    }

    return {
      isOpen: false,
      isEmergency: isEmergency,
      closureType: closureType,
      reason: reason,
      reasonEn: reasonEn,
      nextOpenAt: nextOpenAt
    };
  }

  invalidateCache() {
    nodeCache.del(this.CACHE_KEY);
    logger.info('[WorkingHours] Cache invalidated.');
  }
}

module.exports = new WorkingHoursService();
