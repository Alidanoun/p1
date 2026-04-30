const cron = require('node-cron');
const MaintenanceService = require('../services/maintenanceService');
const logger = require('../utils/logger');
const otpService = require('../services/otpService');
const redis = require('../lib/redis');
const loyaltyService = require('../services/loyaltyService');

/**
 * Automated Maintenance Jobs - Granite Architecture
 * Schedules Archiving, Cleanups, and Metrics.
 * 🔐 All jobs are protected with Redis distributed locks for multi-instance safety.
 */

/**
 * Helper: Execute a job with a Redis distributed lock.
 * Only one instance can run the job at a time.
 */
async function withLock(lockName, ttlSeconds, fn) {
  const lockKey = `lock:cron:${lockName}`;
  const acquired = await redis.set(lockKey, 'running', 'NX', 'EX', ttlSeconds).catch(() => null);
  if (!acquired) {
    logger.info(`[Cron] Job "${lockName}" already running on another instance. Skipping.`);
    return;
  }
  try {
    await fn();
  } finally {
    await redis.del(lockKey).catch(() => {});
  }
}

function initCronJobs(io = null) {
  
  // 1. Cleanup Expired Idempotency Keys & OTPs - Every Hour
  cron.schedule('0 * * * *', async () => {
    await withLock('idempotency_cleanup', 60, async () => {
      try {
        logger.info('Cron Job Trace: Starting Idempotency & OTP Cleanup...');
        await MaintenanceService.cleanupIdempotency();
        await otpService.cleanupExpired();
      } catch (err) {
        logger.error('Cron Job Failed: Idempotency/OTP Cleanup', { error: err.message });
      }
    });
  });

  // 1.5. 🧹 تنظيف سجلات التنبيهات والـ Idempotency - كل يوم الساعة 4 صباحاً
  cron.schedule('0 4 * * *', async () => {
    await withLock('daily_maintenance', 300, async () => {
      try {
        logger.info('Cron Job Trace: Starting Maintenance Cleanups...');
        await MaintenanceService.cleanupNotificationLogs();
        await MaintenanceService.cleanupOldIdempotencyRecords();
      } catch (err) {
        logger.error('Cron Job Failed: Maintenance Cleanups', { error: err.message });
      }
    });
  });

  // 2. Batch Archiving of Audit Logs - Every Day at 3:00 AM
  cron.schedule('0 3 * * *', async () => {
    await withLock('audit_archiving', 600, async () => {
      try {
        logger.info('Cron Job Trace: Starting Batch Archiving (Older than 30 days)...');
        let totalMoved = 0;
        let batchMoved = 0;
        
        // Process in batches of 500 to prevent DB locks
        do {
          batchMoved = await MaintenanceService.archiveAuditLogs(30, 500);
          totalMoved += batchMoved;
        } while (batchMoved === 500);

        if (totalMoved > 0) {
          logger.info(`Cron Job Trace: Archiving Finished. Total moved to archive: ${totalMoved}`);
        }
      } catch (err) {
        logger.error('Cron Job Failed: Archiving', { error: err.message });
      }
    });
  });

  // 3. System Performance Metrics - Every 30 minutes
  cron.schedule('30 * * * *', async () => {
    await withLock('performance_metrics', 60, async () => {
      try {
        logger.info('Cron Job Trace: Logging System Performance Metrics...');
        await MaintenanceService.logPerformanceMetrics(io);
      } catch (err) {
        logger.error('Cron Job Failed: Metrics Logging', { error: err.message });
      }
    });
  });
  
  // 4. 🟢 الإضافة الوقائية: تنظيف الطلبات العالقة - كل ساعة (الدقيقة 15)
  // Note: cleanupStuckOrders() has its own internal distributed lock too (double safety)
  cron.schedule('15 * * * *', async () => {
    try {
      logger.info('Cron Job Trace: Starting Cleanup of Stuck Pending Orders...');
      await MaintenanceService.cleanupStuckOrders();
    } catch (err) {
      logger.error('Cron Job Failed: Stuck Orders Cleanup', { error: err.message });
    }
  });

  // تشغيل أولي عند بدء السيرفر (Startup Check) بعد 5 ثوانٍ لضمان استقرار الربط
  setTimeout(async () => {
    try {
      logger.info('Startup Trace: Running Initial Stuck Orders Cleanup...');
      await MaintenanceService.cleanupStuckOrders();
      await MaintenanceService.cleanupOldIdempotencyRecords();
      await MaintenanceService.cleanupNotificationLogs();
      await otpService.cleanupExpired();
    } catch (err) {
      logger.error('Startup Cleanup Failed', { error: err.message });
    }
  }, 5000);

  // 5. 🎁 Happy Hour Monitoring - Every Minute
  // Automatically disables Happy Hour when the time window passes
  cron.schedule('* * * * *', async () => {
    try {
      const result = await loyaltyService.checkAndAutoDisable();
      if (result && result.disabled) {
        logger.info(`[Cron] Happy Hour automatically disabled for config ID: ${result.id}`);
        // Notify all clients (Admin + App) to refresh their state
        if (io) {
          io.emit('loyalty:configUpdated', { refreshNeeded: true });
        }
      }
    } catch (err) {
      logger.error('Cron Job Failed: Happy Hour Monitoring', { error: err.message });
    }
  });

  logger.info('🚀 Automated Maintenance Jobs (Archiving & Cleanup) Initialized.');
}

module.exports = { initCronJobs };
