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
 * 🌍 All cron schedules use the dynamic timezone from database settings.
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

/**
 * 🌍 Load operating timezone from database settings.
 * Falls back to 'Asia/Amman' if the database is unavailable.
 */
async function loadTimezone() {
  try {
    const prisma = require('../lib/prisma');
    const settings = await prisma.restaurantSettings.findFirst({ where: { id: 1 }, select: { timezone: true } });
    const tz = settings?.timezone || 'Asia/Amman';
    logger.info(`[Cron] Operating timezone loaded: ${tz}`);
    return tz;
  } catch (err) {
    logger.warn('[Cron] Failed to load timezone from DB, falling back to Asia/Amman', { error: err.message });
    return 'Asia/Amman';
  }
}

async function initCronJobs(io = null) {
  // 🌍 Load timezone once at startup for all cron schedules
  const timezone = await loadTimezone();
  
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
  }, { timezone });

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
  }, { timezone });

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
  }, { timezone });

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
  }, { timezone });
  
  // 4. 🟢 تنظيف الطلبات العالقة - كل 10 دقائق
  cron.schedule('*/10 * * * *', async () => {
    await withLock('cancellation_timeout', 60, async () => {
      try {
        logger.info('Cron Job Trace: Checking for Stuck Cancellation Requests...');
        await MaintenanceService.cleanupWaitingCancellations();
      } catch (err) {
        logger.error('Cron Job Failed: Cancellation Timeout Cleanup', { error: err.message });
      }
    });
  }, { timezone });

  // تشغيل أولي عند بدء السيرفر (Startup Check) - Temporarily disabled to debug login timeouts
  /*
  setTimeout(async () => {
    // ...
  }, 10000);
  */

  // 6. 🏆 Bestseller (الأكثر طلباً) Update - Every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    await withLock('bestseller_update', 120, async () => {
      try {
        logger.info('Cron Job Trace: Updating Automatic Bestsellers...');
        const bestsellerService = require('../services/bestsellerService');
        await bestsellerService.updateBestsellers();
      } catch (err) {
        logger.error('Cron Job Failed: Bestseller Update', { error: err.message });
      }
    });
  }, { timezone });

  // 7. 🎁 Rewards Maintenance: Cleanup Expired Rewards - Every Day at 5:00 AM
  cron.schedule('0 5 * * *', async () => {
    await withLock('reward_expiry_cleanup', 300, async () => {
      try {
        logger.info('Cron Job Trace: Starting Reward Expiry Cleanup...');
        await MaintenanceService.cleanupExpiredRewards();
      } catch (err) {
        logger.error('Cron Job Failed: Reward Expiry Cleanup', { error: err.message });
      }
    });
  }, { timezone });

  // 8. 🛡️ Loyalty Integrity: Global Ledger Reconciliation - Every Day at 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    await withLock('loyalty_reconciliation', 600, async () => {
      try {
        logger.info('Cron Job Trace: Starting Global Loyalty Ledger Reconciliation...');
        await MaintenanceService.reconcileLoyaltyLedger();
      } catch (err) {
        logger.error('Cron Job Failed: Loyalty Reconciliation', { error: err.message });
      }
    });
  }, { timezone });

  // 9. 🛡️ System Integrity Reconciliation - Every 2 Hours
  cron.schedule('0 */2 * * *', async () => {
    await withLock('system_integrity_audit', 300, async () => {
      try {
        const validator = require('../services/systemValidator');
        logger.info('Cron Job Trace: Starting System Integrity Reconciliation...');
        
        // 1. Check for stalled modification flows
        const stuckCount = await validator.checkStuckModifications();
        if (stuckCount > 0) logger.warn(`[Integrity] Found ${stuckCount} stuck modifications.`);
      } catch (err) {
        logger.error('Cron Job Failed: System Integrity Audit', { error: err.message });
      }
    });
  }, { timezone });

  // 7. 📮 Transactional Outbox Dispatcher - Every 5 seconds (High Frequency)
  // Ensures events saved in DB are dispatched to subscribers reliably.
  setInterval(async () => {
    await withLock('outbox_dispatcher', 10, async () => {
      try {
        const container = require('../lib/container');
        await container.outboxService.dispatchPending();
      } catch (err) {
        // Silently log outbox errors to avoid spamming cron logs
        logger.error('[Outbox] Background dispatch failed', { error: err.message });
      }
    });
  }, 5000);

  // 8. 🎁 Loyalty Maintenance (Happy Hour Auto-Disable) - Every 1 minute
  cron.schedule('* * * * *', async () => {
    await withLock('loyalty_maintenance', 55, async () => {
      try {
        const result = await loyaltyService.checkAndAutoDisable();
        if (result && result.disabled) {
          logger.info(`[Loyalty] Happy Hour session ended automatically for config ${result.id}`);
        }
      } catch (err) {
        logger.error('Cron Job Failed: Loyalty Maintenance', { error: err.message });
      }
    });
  }, { timezone });

  // 9. 🕒 Financial Approval Expiry - Every 6 Hours
  cron.schedule('0 */6 * * *', async () => {
    await withLock('financial_approval_expiry', 300, async () => {
      try {
        logger.info('Cron Job Trace: Running Financial Approval Expiry...');
        await MaintenanceService.expireFinancialApprovals();
      } catch (err) {
        logger.error('Cron Job Failed: Financial Approval Expiry', { error: err.message });
      }
    });
  }, { timezone });

  // 10. 📊 Daily Financial Snapshotting - Every Day at 1:00 AM
  cron.schedule('0 1 * * *', async () => {
    await withLock('financial_snapshotting', 600, async () => {
      try {
        logger.info('Cron Job Trace: Generating Daily Financial Snapshots...');
        const container = require('../lib/container');
        await container.financialSnapshotService.processNightlyBatch();
      } catch (err) {
        logger.error('Cron Job Failed: Financial Snapshotting', { error: err.message });
      }
    });
  }, { timezone });

  logger.info(`🚀 Automated Maintenance Jobs Initialized (Timezone: ${timezone}).`);
}

module.exports = { initCronJobs };
