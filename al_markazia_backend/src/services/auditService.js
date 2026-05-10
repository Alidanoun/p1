const Redis = require('ioredis');
const { sanitizeForAudit } = require('../utils/auditSanitizer');
const { translateAction, getFriendlyCategory } = require('../utils/auditTranslator');
const { decrypt } = require('../utils/crypto');

/**
 * 🕵️ Enterprise Audit Service
 * Provides centralized logging with diff support and severity levels.
 * Supports distributed real-time broadcasting via Redis.
 */
class AuditService {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
    this.instanceId = process.env.INSTANCE_ID || `inst-${Math.random().toString(36).substr(2, 5)}`;
    
    // 📡 Redis Cluster Sync
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
    };

    this.publisher = new Redis(redisConfig);
    this.subscriber = new Redis({ ...redisConfig, enableReadyCheck: false });

    this.setupSubscriber();
  }

  /**
   * 📡 Listen for logs from other instances
   */
  setupSubscriber() {
    this.subscriber.on('connect', () => {
      this.subscriber.subscribe('audit:log_broadcast');
      this.logger.info(`🕵️ [AuditSync] Subscriber Active: ${this.instanceId}`);
    });

    this.subscriber.on('message', (channel, message) => {
      if (channel === 'audit:log_broadcast') {
        try {
          const { entry, originInstance } = JSON.parse(message);
          
          // Only process logs from OTHER instances to avoid duplication
          if (originInstance !== this.instanceId) {
            const socket = require('../socket');
            if (socket.isReady()) {
              socket.getIO().to('system-logs').emit('audit:new_log', entry);
            }
          }
        } catch (err) {
          this.logger.error('[AuditSync] Parse failed', { error: err.message });
        }
      }
    });
  }

  /**
   * Log an event to the SystemAuditLog
   * 🔥 [PERF-FIX] Non-blocking by default unless explicitly awaited
   */
  async log(params) {
    // We return immediately and handle the work in the background to avoid blocking the API response
    setImmediate(() => {
      this._performLog(params).catch(err => 
        this.logger.error('[AUDIT_LOG_ASYNC_FAILURE]', { error: err.message, action: params.action })
      );
    });
    return true; // Return a dummy success to avoid breaking callers
  }

  /**
   * 🛡️ Internal: Actual Logging Execution (Database + Broadcast)
   */
  async _performLog(params) {
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
      // ✅ Sanitize metadata before saving
      const cleanMetadata = sanitizeForAudit(metadata);

      const logEntry = {
        userId,
        userEmail: params.userEmail || req?.user?.email || null,
        userRole,
        action,
        entityType,
        entityId: entityId?.toString(),
        status,
        severity,
        metadata: cleanMetadata,
        ip: req?.ip || req?.headers['x-forwarded-for'] || null,
        userAgent: req?.headers['user-agent'] || null
      };

      // 1. Persist to DB
      const entry = await this.prisma.systemAuditLog.create({
        data: logEntry
      });

      // 🌍 1.5. Enrich for Real-time (Friendly Fields)
      let displayUser = entry.userEmail || 'النظام الآلي';
      if (displayUser.includes(':')) displayUser = decrypt(displayUser);

      const enrichedEntry = {
        ...entry,
        friendlyAction: translateAction(entry.action),
        friendlyCategory: getFriendlyCategory(entry),
        userDisplay: displayUser
      };

      // 📡 2. Redis Broadcast (To all instances)
      try {
        await this.publisher.publish('audit:log_broadcast', JSON.stringify({
          entry: enrichedEntry,
          originInstance: this.instanceId,
          timestamp: new Date().toISOString()
        }));
      } catch (rErr) {
        this.logger.error('[AUDIT_REDIS_BROADCAST] Failed', { error: rErr.message });
      }

      // 📡 3. Local Socket Broadcast (To local admins)
      try {
        const socket = require('../socket');
        if (socket.isReady()) {
          socket.getIO().to('system-logs').emit('audit:new_log', enrichedEntry);
        }
      } catch (sErr) {
        // Silent fail
      }

      // 4. High Severity Alerting (Console/External)
      if (severity === 'CRITICAL' || status === 'FAIL') {
        this.logger.security(`[AUDIT_ALERT] ${action} - Status: ${status}`, {
          userId,
          entityId,
          severity,
          metadata
        });
      }

      return entry;
    } catch (err) {
      this.logger.error('[AUDIT_LOG_FAILURE]', { error: err.message, action });
      return null;
    }
  }

  /**
   * 🧹 Graceful Cleanup
   */
  async destroy() {
    await this.publisher.quit();
    await this.subscriber.quit();
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

  /**
   * 🏢 Specialized: Log Branch Switch
   */
  async logBranchSwitch(userId, userRole, fromBranchId, toBranchId, req = null) {
    return this.log({
      userId,
      userEmail: req?.user?.email || null,
      userRole,
      action: 'BRANCH_SWITCH',
      severity: 'INFO',
      metadata: {
        from: fromBranchId,
        to: toBranchId,
        timestamp: new Date().toISOString()
      },
      req
    });
  }
}

// --- 🛡️ Backward Compatibility ---
const getContainer = () => require('../lib/container');
const proxy = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'AuditService') return AuditService;
    const service = getContainer().auditService;
    const val = service[prop];
    return typeof val === 'function' ? val.bind(service) : val;
  }
});

module.exports = proxy;
module.exports.AuditService = AuditService;
