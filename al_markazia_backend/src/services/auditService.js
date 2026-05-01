const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

/**
 * 🕵️ Enterprise Audit Service
 * Provides centralized logging with diff support and severity levels.
 */
class AuditService {
  /**
   * Log an event to the SystemAuditLog
   */
  async log(params) {
    const {
      userId = null,
      userRole = null,
      action,
      entityType = null,
      entityId = null,
      status = 'SUCCESS',
      severity = 'INFO',
      metadata = {},
      req = null // If provided, extract IP and UA
    } = params;

    try {
      const logEntry = {
        userId,
        userRole,
        action,
        entityType,
        entityId: entityId?.toString(),
        status,
        severity,
        metadata,
        ip: req?.ip || req?.headers['x-forwarded-for'] || null,
        userAgent: req?.headers['user-agent'] || null
      };

      // 1. Persist to DB
      const entry = await prisma.systemAuditLog.create({
        data: logEntry
      });

      // 📡 3. Real-time Broadcast to Admins
      try {
        const socket = require('../socket');
        if (socket.isReady()) {
          socket.getIO().to('system-logs').emit('audit:new_log', entry);
        }
      } catch (sErr) {
        // Silent fail for socket broadcast to ensure core audit persistence
      }

      // 2. High Severity Alerting (Console/External)
      if (severity === 'CRITICAL' || status === 'FAIL') {
        logger.security(`[AUDIT_ALERT] ${action} - Status: ${status}`, {
          userId,
          entityId,
          severity,
          metadata
        });
      }

      return entry;
    } catch (err) {
      // 🛡️ Reliability Guard: Do not crash if audit logging fails, just log the error.
      logger.error('[AUDIT_LOG_FAILURE]', { error: err.message, action });
      return null;
    }
  }

  /**
   * 🔄 Helper: Log with Diff
   */
  async logWithDiff(params, before, after) {
    const diff = this.calculateDiff(before, after);
    if (Object.keys(diff).length === 0 && params.status !== 'FAIL') return null; // No change, skip logging unless failed

    return this.log({
      ...params,
      metadata: {
        ...params.metadata,
        before,
        after,
        diff
      }
    });
  }

  /**
   * 🧮 Simple Shallow Diff Calculator
   */
  calculateDiff(before, after) {
    const diff = {};
    if (!before || !after) return diff;

    Object.keys(after).forEach(key => {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        diff[key] = { from: before[key], to: after[key] };
      }
    });
    return diff;
  }
}

module.exports = new AuditService();
