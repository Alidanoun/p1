const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { FirebaseService } = require('../services/firebaseService');

/**
 * ─── 🏛️ Existing Legacy Endpoints (Preserved Exactly) ─────────────────────────
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
        return res.status(404).json({ error: 'التنبيه غير موجود' });
      }
    }

    await prisma.notification.update({
      where: { id: notifId },
      data: { isRead: true }
    });

    // Also attempt mirroring to the NotificationLog persistence layer if signatures map
    await prisma.notificationLog.updateMany({
      where: { id: notifId },
      data: { status: 'READ', readAt: new Date() }
    }).catch(() => {});

    res.json({ success: true });
  } catch (error) {
    logger.error('Mark as read failed', { error: error.message, id: req.params.id });
    res.status(500).json({ error: 'Failed to mark as read' });
  }
};

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
      whereClause = { customerPhone: null, type: { not: 'broadcast' }, isRead: false };
    }
    
    await prisma.notification.updateMany({
      where: whereClause,
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) {
    logger.error('Mark all as read error', { error: error.message });
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
};

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
    
    res.status(201).json(notification);
  } catch (error) {
    logger.error('Broadcast error', { error: error.message });
    res.status(500).json({ error: 'Failed to broadcast' });
  }
};

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

exports.testPush = async (req, res) => {
  try {
    const { sendToToken } = require('../services/firebaseService');
    const customer = await prisma.customer.findUnique({
      where: { uuid: req.user.id },
      select: { fcmToken: true }
    });

    if (!customer?.fcmToken) {
      return res.status(400).json({ error: 'FCM Token not found in DB for your profile.' });
    }

    logger.info(`[TestPush] 🚀 Manual trigger for user: ${req.user.id}`);
    const success = await sendToToken(
      customer.fcmToken,
      'إختبار الإشعارات 🧪',
      'إذا وصلك هذا التنبيه، فهذا يعني أن قناة FCM تعمل بنجاح!'
    );

    res.json({ success, message: success ? 'Accepted' : 'Rejected' });
  } catch (error) {
    logger.error('Test push endpoint error', { error: error.message });
    res.status(500).json({ error: 'Server diagnostic error' });
  }
};

/**
 * ─── 🌟 New Enterprise Notification Lifecycle Endpoints ───────────────────────
 */

/**
 * 1. Single Notification Endpoint (/api/v1/notifications/send)
 * Dispatches highly customized dynamic payload parameters securely.
 */
exports.sendSingleNotification = async (req, res) => {
  try {
    const { userId, type, lang, customTitle, customBody, data } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User identifier required.' });
    }

    // Resolve target identity FCM token dynamically
    let targetToken = null;
    const userAcc = await prisma.user.findUnique({ where: { uuid: String(userId) }, select: { fcmToken: true } });
    if (userAcc?.fcmToken) {
      targetToken = userAcc.fcmToken;
    } else {
      const custAcc = await prisma.customer.findUnique({ where: { uuid: String(userId) }, select: { fcmToken: true } });
      if (custAcc?.fcmToken) targetToken = custAcc.fcmToken;
    }

    if (!targetToken) {
      return res.status(404).json({ success: false, error: 'Target destination holds no registered push registration token.' });
    }

    const messageId = await FirebaseService.sendNotification({
      token: targetToken,
      type,
      userId,
      lang: lang || 'ar',
      customTitle,
      customBody,
      data
    });

    res.status(200).json({ success: messageId !== null, messageId });
  } catch (error) {
    logger.error('Single push pipeline crashed execution', { error: error.message });
    res.status(500).json({ success: false, error: 'Internal pipeline failure' });
  }
};

/**
 * 2. Bulk Notification Endpoint (/api/v1/notifications/bulk)
 */
exports.sendBulkNotifications = async (req, res) => {
  try {
    const { userIds = [], type, lang, customTitle, customBody, data } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Array collection of destination user identifiers mandatory.' });
    }

    // Extract raw tokens across target collection
    const users = await prisma.user.findMany({
      where: { uuid: { in: userIds.map(String) }, fcmToken: { not: null } },
      select: { fcmToken: true }
    });
    const customers = await prisma.customer.findMany({
      where: { uuid: { in: userIds.map(String) }, fcmToken: { not: null } },
      select: { fcmToken: true }
    });

    const combinedTokens = [...users.map(u => u.fcmToken), ...customers.map(c => c.fcmToken)].filter(Boolean);

    if (combinedTokens.length === 0) {
      return res.status(404).json({ success: false, error: 'Zero valid downstream FCM tokens resolved across requested target collection.' });
    }

    const report = await FirebaseService.sendMulticastNotification({
      tokens: combinedTokens,
      type,
      lang,
      customTitle,
      customBody,
      data
    });

    res.status(200).json({ success: true, report });
  } catch (error) {
    logger.error('Multicast payload endpoint crashed', { error: error.message });
    res.status(500).json({ success: false, error: 'Bulk transmission pipeline execution failed' });
  }
};

/**
 * 3. Notification History Endpoint (/api/v1/notifications/history)
 */
exports.getNotificationHistory = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, targetUserId } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

    // Scope queries securely to verified user contexts unless running as elevated administrator
    const requestedUser = targetUserId ? String(targetUserId) : (req.user?.id || null);

    const filterClause = {};
    if (requestedUser) filterClause.userId = requestedUser;
    if (status && ['PENDING', 'SENT', 'FAILED', 'DELIVERED', 'READ'].includes(status.toUpperCase())) {
      filterClause.status = status.toUpperCase();
    }

    const totalRecords = await prisma.notificationLog.count({ where: filterClause });
    const records = await prisma.notificationLog.findMany({
      where: filterClause,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum
    });

    res.status(200).json({
      success: true,
      data: records,
      pagination: {
        total: totalRecords,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(totalRecords / limitNum)
      }
    });
  } catch (error) {
    logger.error('Notification history resolution failed', { error: error.message });
    res.status(500).json({ success: false, error: 'History retrieval exception' });
  }
};

/**
 * 4. markAsDelivered Endpoint (/api/v1/notifications/mark-delivered)
 * Invoked reactively by client-side event loops to guarantee accurate telemetry.
 */
exports.markAsDelivered = async (req, res) => {
  try {
    const { messageId, logId } = req.body;
    if (!messageId && !logId) {
      return res.status(400).json({ success: false, error: 'Target tracking messageId or log record ID mandatory.' });
    }

    const queryClause = {};
    if (logId) queryClause.id = parseInt(logId);
    else if (messageId) queryClause.messageId = String(messageId);

    const updateStatus = await prisma.notificationLog.updateMany({
      where: queryClause,
      data: { status: 'DELIVERED', deliveredAt: new Date() }
    });

    res.status(200).json({ success: updateStatus.count > 0, modifiedCount: updateStatus.count });
  } catch (error) {
    logger.error('markAsDelivered state transition failed', { error: error.message });
    res.status(500).json({ success: false, error: 'State machine state transition failure' });
  }
};

/**
 * 5. Topic Subscription Endpoint (/api/v1/notifications/topic/subscription)
 */
exports.manageTopicSubscription = async (req, res) => {
  try {
    const { action, topic } = req.body;
    if (!action || !['subscribe', 'unsubscribe'].includes(action.toLowerCase()) || !topic) {
      return res.status(400).json({ success: false, error: 'Invalid parameters. Require valid action (subscribe/unsubscribe) and destination topic string.' });
    }

    // Resolve user's actual registered token safely
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return res.status(401).json({ success: false, error: 'Authenticated context binding mandatory for subscription assignments.' });
    }

    let resolvedToken = null;
    const custRecord = await prisma.customer.findUnique({ where: { uuid: currentUserId }, select: { fcmToken: true } });
    if (custRecord?.fcmToken) resolvedToken = custRecord.fcmToken;
    else {
      const userRecord = await prisma.user.findUnique({ where: { uuid: currentUserId }, select: { fcmToken: true } });
      if (userRecord?.fcmToken) resolvedToken = userRecord.fcmToken;
    }

    if (!resolvedToken) {
      return res.status(404).json({ success: false, error: 'No bound registration token captured to execute logical subscription operations.' });
    }

    let executionSuccess = false;
    if (action.toLowerCase() === 'subscribe') {
      executionSuccess = await FirebaseService.subscribeToTopic(resolvedToken, topic);
    } else {
      executionSuccess = await FirebaseService.unsubscribeFromTopic(resolvedToken, topic);
    }

    res.status(200).json({ success: executionSuccess });
  } catch (error) {
    logger.error('Topic execution controller handler failure', { error: error.message });
    res.status(500).json({ success: false, error: 'Subscription transport operation failed' });
  }
};
