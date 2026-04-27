const prisma = require('../lib/prisma');
const socketIo = require('../socket');
const logger = require('../utils/logger');

/**
 * ✅ Secure replacement for Admin notifications
 */
exports.getAdminNotifications = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const notifications = await prisma.notification.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo },
        customerPhone: null,
        type: { not: 'broadcast' }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    res.json(notifications);
  } catch (error) {
    logger.error('Fetch admin notifications error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

/**
 * 🔒 Securely fetch authenticated customer notifications
 * Uses req.user.id (UUID) to resolve identity.
 */
exports.getMyNotifications = async (req, res) => {
  try {
    const userUuid = req.user.id;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const customer = await prisma.customer.findUnique({ 
        where: { uuid: userUuid },
        select: { phone: true }
    });
    if (!customer) {
      return res.status(404).json({ error: 'ملف الزبون غير موجود' });
    }

    const notifications = await prisma.notification.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo },
        OR: [
          { customerPhone: customer.phone },
          { type: 'broadcast' }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    res.json(notifications);
  } catch (error) {
    logger.error('Fetch my notifications error', { error: error.message, uuid: req.user.id });
    res.status(500).json({ error: 'Failed to fetch your notifications' });
  }
};

/**
 * ✅ markAsRead مع ownership check صارم
 */
exports.markAsRead = async (req, res) => {
  try {
    const notifId = parseInt(req.params.id);
    if (isNaN(notifId)) {
      return res.status(400).json({ error: 'معرّف غير صالح' });
    }
    const notification = await prisma.notification.findUnique({
      where: { id: notifId },
      select: { id: true, customerPhone: true, type: true }
    });
    if (!notification) {
      return res.status(404).json({ error: 'التنبيه غير موجود' });
    }

    // Customer: must own it OR it must be a broadcast
    if (req.user.role === 'customer') {
      const customer = await prisma.customer.findUnique({
        where: { uuid: req.user.id },
        select: { phone: true }
      });
      if (!customer) return res.status(404).json({ error: 'الزبون غير موجود' });
      
      const isOwner = notification.customerPhone === customer.phone || 
                      notification.type === 'broadcast';
      
      if (!isOwner) {
        logger.security('Notification ownership violation', {
          notificationId: notifId,
          attemptedBy: req.user.id,
          ip: req.ip
        });
        return res.status(404).json({ error: 'التنبيه غير موجود' }); // anti-enumeration
      }
    }

    // Admin or Verified Owner
    await prisma.notification.update({
      where: { id: notifId },
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) {
    logger.error('Mark as read failed', { error: error.message, id: req.params.id });
    res.status(500).json({ error: 'Failed to mark as read' });
  }
};

/**
 * ✅ markAllAsRead بدون legacy path
 */
exports.markAllAsRead = async (req, res) => {
  try {
    let whereClause;
    if (req.user.role === 'customer') {
      const customer = await prisma.customer.findUnique({
        where: { uuid: req.user.id },
        select: { phone: true }
      });
      if (!customer) return res.status(404).json({ error: 'Customer not found' });
      whereClause = { customerPhone: customer.phone, isRead: false };
    } else {
      // Admin
      whereClause = { customerPhone: null, type: { not: 'broadcast' }, isRead: false };
    }
    
    await prisma.notification.updateMany({
      where: whereClause,
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) {
    logger.error('Mark all as read error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
};

/**
 * Broadcast: Admin only
 */
exports.broadcast = async (req, res) => {
  try {
    const { title, message } = req.body;
    const { publishEvent } = require('../events/eventPublisher');

    const notification = await prisma.notification.create({
      data: { title, message, type: 'broadcast' }
    });

    await publishEvent({
      type: 'system.broadcast',
      aggregateId: notification.id,
      payload: { title, message, metadata: { type: 'broadcast', id: notification.id.toString() } }
    });

    // 🛡️ SECURITY: Manual emit removed to prevent double notifications. 
    // Dispatch is now handled centrally via publishEvent -> notificationService.
    
    res.status(201).json(notification);
  } catch (error) {
    logger.error('Broadcast error', { error: error.message });
    res.status(500).json({ error: 'Failed to broadcast' });
  }
};

/**
 * 🗑️ Secure: Delete notification with ownership check
 */
exports.deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const notifId = parseInt(id);
    const notification = await prisma.notification.findUnique({ where: { id: notifId } });

    if (!notification) return res.status(404).json({ error: 'Notification not found' });

    if (req.user.role === 'customer') {
      const customer = await prisma.customer.findUnique({ where: { uuid: req.user.id } });
      if (!customer || notification.customerPhone !== customer.phone) {
        return res.status(404).json({ error: 'Notification not found' });
      }
    }

    await prisma.notification.delete({ where: { id: notifId } });
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete notification error', { error: error.message });
    res.status(500).json({ error: 'Failed to delete notification' });
  }
};

/**
 * 🧪 Diagnostic: Direct FCM Test Trigger
 * Purpose: Verify Firebase connectivity without involving DB/Socket logic.
 */
exports.testPush = async (req, res) => {
  try {
    const firebaseService = require('../services/firebaseService');
    const customer = await prisma.customer.findUnique({
      where: { uuid: req.user.id },
      select: { fcmToken: true }
    });

    if (!customer?.fcmToken) {
      return res.status(400).json({ error: 'FCM Token not found in DB for your profile.' });
    }

    logger.info(`[TestPush] 🚀 Manual trigger for user: ${req.user.id}`);
    const success = await firebaseService.sendToToken(
      customer.fcmToken,
      'إختبار الإشعارات 🧪',
      'إذا وصلك هذا التنبيه، فهذا يعني أن قناة FCM تعمل بنجاح!',
      { 
        type: 'test', 
        timestamp: String(Date.now()),
        fingerprint: JSON.stringify({
          notificationId: 'test_id',
          priority: 'HIGH',
          timestamp: Date.now(),
          deduplicationKey: 'test_manual_push'
        })
      }
    );

    res.json({ 
      success, 
      message: success ? 'FCM request accepted by Google' : 'FCM request rejected (Check backend logs)' 
    });
  } catch (error) {
    logger.error('Test push endpoint error', { error: error.message });
    res.status(500).json({ error: 'Server diagnostic error' });
  }
};

// Cleanup task remains handled in cronJobs.js
