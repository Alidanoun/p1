
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

/**
 * Maintenance Service - Granite Architecture
 * Handles Batch Archiving, Data Cleanup, and Monitoring.
 */
class MaintenanceService {
  
  /**
   * Archives old Audit Logs in batches to maintain high performance.
   * Only archives logs for completed/cancelled orders.
   */
  static async archiveAuditLogs(days = 30, batchSize = 500) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let totalArchived = 0;

    try {
      // Find candidate logs
      const logs = await prisma.orderAuditLog.findMany({
        where: {
          createdAt: { lt: cutoff },
          order: {
            status: { in: ['delivered', 'cancelled'] }
          }
        },
        take: batchSize
      });

      if (logs.length === 0) return 0;

      // Atomic Move: Insert to Archive then Delete from Main
      await prisma.$transaction(async (tx) => {
        // Prepare data (excluding original local ID if it differs or keeping it if needed)
        const archiveData = logs.map(log => {
          const { id, ...data } = log;
          return data;
        });

        await tx.orderAuditLogArchive.createMany({ data: archiveData });
        await tx.orderAuditLog.deleteMany({
          where: { id: { in: logs.map(l => l.id) } }
        });
      });

      totalArchived = logs.length;
      logger.info(`Maintenance: Archived ${totalArchived} audit logs.`);
      return totalArchived;

    } catch (error) {
      logger.error('Maintenance: Archiving Failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Cleans up expired Idempotency records to keep the table light.
   */
  static async cleanupIdempotency() {
    try {
      const result = await prisma.idempotencyRecord.deleteMany({
        where: { expiresAt: { lt: new Date() } }
      });
      if (result.count > 0) {
        logger.info(`Maintenance: Cleaned up ${result.count} expired idempotency keys.`);
      }
      return result.count;
    } catch (error) {
      logger.error('Maintenance: Idempotency Cleanup Failed', { error: error.message });
    }
  }

  /**
   * Monitoring: Checks the health of the system and triggers alerts.
   * @param {object} io - Socket.io instance for real-time alerts
   */
  static async logPerformanceMetrics(io = null) {
    try {
      const lastHour = new Date(Date.now() - 60 * 60 * 1000);
      
      // 1. Fetch Notification Failure Rate
      const totalNotifications = await prisma.notificationLog.count({
        where: { createdAt: { gte: lastHour } }
      });
      const failedNotifications = await prisma.notificationLog.count({
        where: { createdAt: { gte: lastHour }, status: 'failed' }
      });

      const notificationFailureRate = totalNotifications > 0 ? (failedNotifications / totalNotifications) : 0;

      // 2. Fetch Version Conflicts (Optimistic Lock failures)
      // Since conflicts aren't always logged in a table, we estimate from audit logs 
      // or track specifically if we add a 'CONFLICT' event. 
      // For now, tracking cancellation spikes as a business metric.
      const cancellationSpikes = await prisma.orderCancellation.count({
        where: { createdAt: { gte: lastHour }, status: 'approved' }
      });

      logger.info('📊 Performance Metrics Checked', { 
        totalNotifications, 
        failureRate: notificationFailureRate.toFixed(2),
        cancellationSpikes 
      });

      // 3. 🚨 SMART ALERTS 🚨
      if (io) {
        // Notification Alert
        if (notificationFailureRate > 0.1) { // 10%
          const alert = {
            title: '⚠️ فشل عالي في الإشعارات',
            message: `فشل إرسال ${failedNotifications} إشعار من أصل ${totalNotifications} خلال الساعة الماضية.`,
            level: 'danger',
            type: 'NOTIFICATION_FAILURE'
          };
          io.to('admins').emit('system_alert', alert);
          logger.warn('System Alert Triggered: High Notification Failure');
        }

        // Cancellation Spike Alert
        if (cancellationSpikes > 10) { // arbitrary threshold for spike
          const alert = {
            title: '🔥 قفزة في الإلغاءات',
            message: `تم إلغاء ${cancellationSpikes} طلبات خلال الساعة الماضية. يرجى مراجعة الأسباب.`,
            level: 'warning',
            type: 'CANCELLATION_SPIKE'
          };
          io.to('admins').emit('system_alert', alert);
          logger.warn('System Alert Triggered: Cancellation Spike');
        }
      }
      
    } catch (error) {
      logger.error('Maintenance: Metrics Checking Failed', { error: error.message });
    }
  }

  /**
   * 🟢 الإضافة الوقائية: تنظيف الطلبات العالقة
   * تبحث عن الطلبات في حالة pending التي مضى عليها أكثر من 30 دقيقة وتفعلها تلقائياً.
   */
  static async cleanupStuckOrders() {
    try {
      const thresholdMinutes = 30;
      const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

      const stuckOrders = await prisma.order.findMany({
        where: {
          status: 'pending',
          createdAt: { lt: cutoff }
        }
      });

      if (stuckOrders.length === 0) return 0;

      // استيراد دالة التحديث لتجنب التعارض الدائري (Circular Dependency)
      // يتم الاستيراد محلياً داخل الدالة لضمان توفرها وقت التنفيذ فقط.
      const { performStatusUpdate } = require('../controllers/orderController');

      let processedCount = 0;
      for (const order of stuckOrders) {
        try {
          await performStatusUpdate(order.id, 'preparing');
          logger.info('🟢 Stuck Order Auto-Accepted by Cleanup Job', { 
            orderId: order.id, 
            orderNumber: order.orderNumber 
          });
          processedCount++;
        } catch (err) {
          logger.error('🔴 Failed to auto-accept stuck order during cleanup', { 
            orderId: order.id, 
            error: err.message 
          });
        }
      }
      return processedCount;
    } catch (error) {
      logger.error('Maintenance: Cleanup Stuck Orders Failed', { error: error.message });
      return 0;
    }
  }

  /**
   * 🧹 حماية النظام: تنظيف سجلات التنبيهات القديمة (أقدم من 10 أيام)
   */
  static async cleanupNotificationLogs() {
    try {
      const threshold = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days
      const result = await prisma.notificationLog.deleteMany({
        where: { createdAt: { lt: threshold } }
      });
      if (result.count > 0) {
        logger.info(`Cleanup: Removed ${result.count} old notification logs.`);
      }
      return result.count;
    } catch (error) {
      logger.error('Maintenance: Notification Cleanup Failed', { error: error.message });
      return 0;
    }
  }

  /**
   * 🧹 حماية النظام: تنظيف سجلات الـ Idempotency المنتهية
   */
  static async cleanupOldIdempotencyRecords() {
    try {
      const result = await prisma.idempotencyRecord.deleteMany({
        where: { expiresAt: { lt: new Date() } }
      });
      if (result.count > 0) {
        logger.info(`Cleanup: Removed ${result.count} expired idempotency records.`);
      }
      return result.count;
    } catch (error) {
      logger.error('Maintenance: Idempotency Cleanup Failed', { error: error.message });
      return 0;
    }
  }
}

module.exports = MaintenanceService;
