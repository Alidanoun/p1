const firebaseService = require('../services/firebaseService');
const prisma = require('../lib/prisma');

/**
 * 📊 Notification Dashboard Controller (Phase 3 Monitoring)
 * Provides real-time insights into notification health and delivery.
 */
class NotificationDashboardController {
  /**
   * GET /api/admin/notifications/stats
   */
  async getStats(req, res) {
    try {
      const fcmMetrics = firebaseService.getMetrics();
      
      // Database stats
      const totalInDb = await prisma.notification.count();
      const pendingCount = await prisma.notification.count({ where: { status: 'PENDING' } });
      const failedInDb = await prisma.notification.count({ where: { status: 'FAILED' } });

      res.json({
        success: true,
        data: {
          fcm: fcmMetrics,
          database: {
            total: totalInDb,
            pending: pendingCount,
            failed: failedInDb
          },
          health: {
            fcmEnabled: firebaseService.isFcmEnabled(),
            timestamp: new Date()
          }
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/admin/notifications/reset-stats
   */
  async resetStats(req, res) {
    try {
      firebaseService.resetMetrics();
      res.json({ success: true, message: 'FCM metrics reset successfully' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}

module.exports = new NotificationDashboardController();
