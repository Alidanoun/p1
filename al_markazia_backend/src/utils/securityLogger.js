const logger = require('./logger');
const redis = require('../lib/redis');

/**
 * 🕵️ Security Logger & Auditor
 * Specialized logging for security-critical events and unauthorized attempts.
 */
class SecurityLogger {
  /**
   * Log an unauthorized branch access attempt.
   * @param {string} userId 
   * @param {string} requestedBranchId 
   * @param {Object} context - Additional metadata (e.g. endpoint, method)
   */
  static async logUnauthorizedBranchAccess(userId, requestedBranchId, context = {}) {
    const logData = {
      timestamp: new Date().toISOString(),
      userId,
      requestedBranchId,
      ...context,
      severity: 'HIGH'
    };

    logger.security(`[BRANCH_VIOLATION] Unauthorized access attempt by user ${userId} to branch ${requestedBranchId}`, logData);

    // Track attempt frequency in Redis to trigger auto-block
    const key = `security:violations:${userId}`;
    const violations = await redis.incr(key);
    if (violations === 1) {
      await redis.expire(key, 3600); // 1 hour window
    }

    if (violations >= 10) {
      logger.security(`[SUSPICIOUS_ACTIVITY] User ${userId} exceeded violation threshold!`, { userId, violations });
      // Here we could trigger an automated account lock if needed
    }
  }

  /**
   * Log user status changes (Bans, Activations).
   */
  static logStatusChange(targetUserId, actorId, newStatus) {
    logger.info(`[SECURITY_AUDIT] User ${targetUserId} status changed to ${newStatus} by admin ${actorId}`);
  }

  /**
   * Log Socket.IO security events.
   */
  static logSocketSecurity(userId, eventName, room, success = false) {
    const level = success ? 'info' : 'warn';
    logger[level](`[SOCKET_SEC] User:${userId} | Event:${eventName} | Room:${room} | Result:${success ? 'GRANTED' : 'DENIED'}`);
  }
}

module.exports = SecurityLogger;
