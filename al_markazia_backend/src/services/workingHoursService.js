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
  async getStatus(branchId) {
    try {
      // 1. Check Cache
      const cacheKey = branchId ? `${this.CACHE_KEY}_${branchId}` : this.CACHE_KEY;
      const cachedStatus = nodeCache.get(cacheKey);
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
      const nowLocal = now; // 🌍 Uses dynamic timezone from settings (no hardcoded override)
      
      // 3. Check Branch-specific status if branchId is provided
      if (branchId && branchId !== 'all' && branchId !== 'null' && branchId !== 'undefined') {
        const branch = await prisma.branch.findUnique({
          where: { id: branchId }
        });
        
        if (branch) {
          // If branch is administratively inactive
          if (!branch.isActive) {
            const status = {
              isOpen: false,
              isEmergency: true,
              closureType: 'emergency',
              reason: 'هذا الفرع مغلق مؤقتاً لأعمال الصيانة والتحديثات',
              reasonEn: 'This branch is temporarily closed for maintenance.'
            };
            nodeCache.set(cacheKey, status, this.CACHE_TTL);
            return status;
          }
          
          // If branch is emergency closed
          if (branch.isEmergencyClosed) {
            const reopenAtLocal = branch.reopenAt ? DateTime.fromJSDate(branch.reopenAt).setZone(settings.timezone) : null;
            const hasReopened = reopenAtLocal && nowLocal >= reopenAtLocal;
            
            if (!hasReopened) {
              const status = {
                isOpen: false,
                isEmergency: true,
                closureType: branch.reopenAt ? 'temporary' : 'emergency',
                reason: branch.closureReason || 'الفرع مغلق مؤقتاً للراحة أو لأسباب فنية',
                nextOpenAt: reopenAtLocal ? reopenAtLocal.toISO() : null
              };
              nodeCache.set(cacheKey, status, this.CACHE_TTL);
              return status;
            } else {
              // Auto-Reopen the branch in DB
              logger.info(`[WorkingHours] Branch ${branchId} emergency closure expired. Reopening automatically.`);
              await prisma.branch.update({
                where: { id: branchId },
                data: {
                  isEmergencyClosed: false,
                  reopenAt: null,
                  closureReason: null
                }
              });
            }
          }
        }
      }

      logger.debug('[WorkingHours] check', { 
        now: nowLocal.toFormat('yyyy-MM-dd HH:mm:ss'),
        day: nowLocal.weekday === 7 ? 0 : nowLocal.weekday,
        timezone: settings.timezone 
      });

      // 🛠️ Define Helper Variables early
      const getM = (t) => {
        if (!t) return 0;
        const dt = DateTime.fromFormat(t, 'HH:mm');
        return dt.isValid ? dt.hour * 60 + dt.minute : 0;
      };
      const nowM = nowLocal.hour * 60 + nowLocal.minute;
      const graceM = settings.lastOrderMinutesBeforeClose || 0;

      // 4. Check Emergency Closure (Hard Close)
      if (settings.isEmergencyClosed) {
        // 🛡️ Auto-Reopen Logic: Check if timed closure has expired
        const reopenAtLocal = settings.reopenAt ? DateTime.fromJSDate(settings.reopenAt).setZone(settings.timezone) : null;
        const hasReopened = reopenAtLocal && nowLocal >= reopenAtLocal;
        
        if (!hasReopened) {
          const status = {
            isOpen: false,
            isEmergency: true,
            closureType: settings.reopenAt ? 'temporary' : 'emergency',
            reason: settings.closureReason || 'المطعم مغلق حالياً لأسباب فنية',
            nextOpenAt: reopenAtLocal ? reopenAtLocal.toISO() : null
          };
          nodeCache.set(cacheKey, status, this.CACHE_TTL);
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
      const yesterday = nowLocal.minus({ days: 1 });
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
            // 🛡️ Format Fix: Flutter expects ISO String for DateTime.parse
            closingAt: nowLocal.set({ 
              hour: DateTime.fromFormat(yesterdaySchedule.closeTime, 'HH:mm').hour, 
              minute: DateTime.fromFormat(yesterdaySchedule.closeTime, 'HH:mm').minute,
              second: 0,
              millisecond: 0
            }).toISO(),
            source: 'yesterday_shift',
            isLateNight: true 
          };
          nodeCache.set(cacheKey, status, this.CACHE_TTL);
          return status;
        }
      }

      // ✅ [SHIFT-FIX] Part B: Check Today's Regular Shift
      const dayOfWeek = nowLocal.weekday === 7 ? 0 : nowLocal.weekday; 
      const todaySchedule = schedule.find(s => s.dayOfWeek === dayOfWeek);

      if (!todaySchedule || todaySchedule.isClosed) {
        const status = await this._getClosedStatus(nowLocal, schedule, settings);
        nodeCache.set(cacheKey, status, this.CACHE_TTL);
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
            // 🛡️ Format Fix: Flutter expects ISO String for DateTime.parse
            closingAt: nowLocal.set({ 
              hour: DateTime.fromFormat(todaySchedule.closeTime, 'HH:mm').hour, 
              minute: DateTime.fromFormat(todaySchedule.closeTime, 'HH:mm').minute,
              second: 0,
              millisecond: 0
            }).toISO()
          }
        : await this._getClosedStatus(nowLocal, schedule, settings);

      nodeCache.set(cacheKey, status, this.CACHE_TTL);
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
          const dt = DateTime.fromFormat(dayData.openTime, 'HH:mm');
          const opening = checkDate.set({ hour: dt.isValid ? dt.hour : 0, minute: dt.isValid ? dt.minute : 0, second: 0, millisecond: 0 });
          
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
    nodeCache.flush();
    logger.info('[WorkingHours] Cache invalidated.');
  }
}

module.exports = new WorkingHoursService();
