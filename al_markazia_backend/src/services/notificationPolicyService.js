const prisma = require('../lib/prisma');
const { DateTime } = require('luxon');
const { EVENT_TYPE_CONFIG, NOTIFICATION_PRIORITIES } = require('../config/priorities.config');
const { DEFAULT_TIMEZONE } = require('../config/constants');
const logger = require('../utils/logger');

/**
 * 🧠 Notification Policy Service (Phase 1 Governance)
 * Enforces user preferences, quiet hours, and channel routing.
 * Hardened SDS 3.1: Multi-Identity Evaluation (Staff & Customers).
 */
class NotificationPolicyService {
  /**
   * Evaluates if a notification should be sent to an identity.
   * @param {number|string} identityId 
   * @param {string} eventType 
   * @param {string} identityType 'user' | 'customer'
   */
  async evaluate(identityId, eventType, identityType = 'user') {
    try {
      const config = EVENT_TYPE_CONFIG[eventType];
      if (!config) {
        return { allowed: false, reason: 'INVALID_EVENT_TYPE', channels: [] };
      }

      // 1. Fetch Identity Preferences & Timezone
      let identity;
      if (identityType === 'customer') {
        const query = typeof identityId === 'string' ? { uuid: identityId } : { id: parseInt(identityId) };
        identity = await prisma.customer.findUnique({
          where: query,
          include: { notificationPreferences: true }
        });
      } else {
        const query = typeof identityId === 'string' ? { uuid: identityId } : { id: parseInt(identityId) };
        identity = await prisma.user.findUnique({
          where: query,
          include: { notificationPreferences: true }
        });
      }

      if (!identity) return { allowed: false, reason: 'IDENTITY_NOT_FOUND', channels: [] };

      // 2. Check Opt-out Status
      const pref = identity.notificationPreferences.find(p => p.category === config.category);
      if (pref && !pref.isEnabled && config.priority !== NOTIFICATION_PRIORITIES.CRITICAL) {
        return { allowed: false, reason: 'IDENTITY_OPTED_OUT', channels: [] };
      }

      // 3. Check Quiet Hours (unless Critical)
      if (config.priority !== NOTIFICATION_PRIORITIES.CRITICAL) {
        const isQuiet = await this.isQuietTime(identity);
        if (isQuiet) {
          return { allowed: false, reason: 'QUIET_HOURS', channels: [] };
        }
      }

      return { allowed: true, reason: null, channels: config.channels };
    } catch (err) {
      logger.error('[NotificationPolicy] Evaluation failed', { identityId, eventType, error: err.message });
      return { allowed: false, reason: 'INTERNAL_ERROR', channels: [] };
    }
  }

  /**
   * Checks if the current time is within the user's quiet hours.
   */
  async isQuietTime(user) {
    const timezone = user.timezone || DEFAULT_TIMEZONE;
    const now = DateTime.now().setZone(timezone);
    const hour = now.hour;

    // Default quiet hours: 11 PM to 7 AM
    const quietStart = user.quietHoursStart || 23;
    const quietEnd = user.quietHoursEnd || 7;

    if (quietStart > quietEnd) {
      // Overnight (e.g., 23 to 7)
      return hour >= quietStart || hour < quietEnd;
    } else {
      // Same day (e.g., 2 to 4)
      return hour >= quietStart && hour < quietEnd;
    }
  }
}

module.exports = new NotificationPolicyService();
