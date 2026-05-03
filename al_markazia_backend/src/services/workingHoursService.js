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
    this.CACHE_TTL = 30; // ⚡ Reduced to 30 seconds for better responsiveness
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
        logger.error('[WORKING_HOURS_FAIL_CLOSE] reason=SETTINGS_MISSING. Blocking orders.');
        return { 
          isOpen: false, 
          reason: 'المطعم مغلق حالياً بسبب خطأ في الإعدادات',
          reasonEn: 'Restaurant is closed due to internal configuration error.'
        };
      }

      const now = DateTime.now().setZone(settings.timezone);

      // 🛠️ Define Helper Variables early
      const getM = (t) => {
        if (!t) return 0;
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
      };
      const nowM = now.hour * 60 + now.minute;
      const graceM = settings.lastOrderMinutesBeforeClose || 0;

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
          // 🚀 Persistence: Update DB to clear the expired flag to prevent log spam and logic drift
          logger.info('[WorkingHours] Emergency closure expired. Reopening automatically in DB.');
          await prisma.restaurantSettings.update({
            where: { id: 1 },
            data: { 
              isEmergencyClosed: false,
              reopenAt: null,
              closureReason: null
            }
          });
          // Invalidate cache for the next request
          this.invalidateCache();
        }
      }

      // ✅ [SHIFT-FIX] Part A: Check Yesterday's Late-Night Shift
      const yesterday = now.minus({ days: 1 });
      const yesterdayDayOfWeek = yesterday.weekday === 7 ? 0 : yesterday.weekday;
      const yesterdaySchedule = schedule.find(s => s.dayOfWeek === yesterdayDayOfWeek);

      if (yesterdaySchedule && !yesterdaySchedule.isClosed) {
        const yOpenM = getM(yesterdaySchedule.openTime);
        const yCloseM = getM(yesterdaySchedule.closeTime);
        
        // If the shift crossed midnight AND we are still before the closing time
        if (yOpenM > yCloseM && nowM < (yCloseM - graceM)) {
          const status = { 
            isOpen: true, 
            isClosed: false,
            isEmergency: false,
            closingAt: yesterdaySchedule.closeTime, 
            source: 'yesterday_shift',
            isLateNight: true 
          };
          nodeCache.set(this.CACHE_KEY, status, this.CACHE_TTL);
          return status;
        }
      }

      // ✅ [SHIFT-FIX] Part B: Check Today's Regular Shift
      const dayOfWeek = now.weekday === 7 ? 0 : now.weekday; 
      const todaySchedule = schedule.find(s => s.dayOfWeek === dayOfWeek);

      if (!todaySchedule || todaySchedule.isClosed) {
        const status = await this._getClosedStatus(now, schedule, settings);
        nodeCache.set(this.CACHE_KEY, status, this.CACHE_TTL);
        return status;
      }

      const openM = getM(todaySchedule.openTime);
      const closeM = getM(todaySchedule.closeTime);

      let isOpen = false;
      if (openM > closeM) {
        // Today's shift crosses into tomorrow
        isOpen = (nowM >= openM || nowM < (closeM - graceM));
      } else {
        isOpen = (nowM >= openM && nowM < (closeM - graceM));
      }

      const status = isOpen 
        ? { 
            isOpen: true, 
            isClosed: false,
            isEmergency: false,
            closingAt: todaySchedule.closeTime 
          }
        : await this._getClosedStatus(now, schedule, settings);

      nodeCache.set(this.CACHE_KEY, status, this.CACHE_TTL);
      return status;
    } catch (error) {
      logger.error('[WORKING_HOURS_FAIL_CLOSE] reason=CALCULATION_ERROR. Blocking orders.', { error: error.message });
      return { 
        isOpen: false, 
        reason: 'المطعم مغلق حالياً لإجراء صيانة تقنية سريعة',
        reasonEn: 'The restaurant is currently closed for quick technical maintenance.'
      };
    }
  }

  async ensureOpen() {
    const status = await this.getStatus();
    if (!status.isOpen) {
      throw new Error(status.reason || 'المطعم مغلق حالياً، لا يمكن استقبال طلبات جديدة');
    }
    return true;
  }

  /**
   * 📡 Generate Dynamic Closed Status
   * Replaces hardcoded strings with real schedule data.
   */
  async _getClosedStatus(now, schedule, settings) {
    const isEmergency = settings.isEmergencyClosed && !(settings.reopenAt && now >= DateTime.fromJSDate(settings.reopenAt).setZone(settings.timezone));
    
    let reason = 'المطعم مغلق حالياً.';
    let reasonEn = 'The restaurant is currently closed.';
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
        reason = settings.closureReason || "نعتذر عن الإزعاج، المطعم مغلق حالياً لأعمال صيانة وتحسينات لضمان أفضل جودة لكم. سنفتح قريباً!";
        reasonEn = "The restaurant is currently closed for maintenance. We will open soon!";
      }
    } else {
      closureType = 'end_of_day';
      const arabicDays = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      const englishDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      // Find the next available working day
      for (let i = 0; i < 7; i++) {
        const checkDate = now.plus({ days: i });
        const checkDay = checkDate.weekday === 7 ? 0 : checkDate.weekday;
        const dayData = schedule.find(s => s.dayOfWeek === checkDay && !s.isClosed);
        
        if (dayData) {
          const [h, m] = dayData.openTime.split(':').map(Number);
          const opening = checkDate.set({ hour: h, minute: m, second: 0, millisecond: 0 });
          
          if (opening > now) {
            nextOpenAt = opening.toISO();
            const dayNameAr = i === 0 ? 'اليوم' : arabicDays[checkDay];
            const dayNameEn = i === 0 ? 'today' : englishDays[checkDay];
            
            reason = `نعتذر منك، مطعم المركزية مغلق حالياً. نسعد باستقبال طلباتك ${dayNameAr} من الساعة ${dayData.openTime} وحتى ${dayData.closeTime}.`;
            reasonEn = `Sorry, we are closed. We are happy to receive your orders ${dayNameEn} from ${dayData.openTime} to ${dayData.closeTime}.`;
            break;
          }
        }
      }
    }

    return {
      isOpen: false,
      isClosed: true,
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
