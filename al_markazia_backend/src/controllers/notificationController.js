const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { FirebaseService } = require('../services/firebaseService');

/**
 * 🏛️ Hardened Notification Controller (SDS 3.1)
 * Enforces NotificationLog as Single Source of Truth.
 * Resolves IDOR vulnerabilities and identifier mismatches.
 */

/**
 * 1. Admin/Staff Notifications History
 */
exports.getAdminNotifications = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const filter = {
      createdAt: { gte: thirtyDaysAgo },
      userId: { in: ['system', 'admin'] }, // Logical admin context
      type: { not: 'broadcast' }
    };

    // If not global admin, enforce branch isolation
    if (req.user.role !== 'admin' && req.user.branchId) {
      const branchOrders = await prisma.order.findMany({
        where: { branchId: req.user.branchId, createdAt: { gte: thirtyDaysAgo } },
        select: { id: true }
      });
      const orderIds = branchOrders.map(o => o.id);
      filter.OR = [
        { orderId: { in: orderIds } },
        { orderId: null } // System-level logs are globally accessible
      ];
    }

    const notifications = await prisma.notificationLog.findMany({
      where: filter,
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
 * 2. Personal Customer Notifications History
 */
exports.getMyNotifications = async (req, res) => {
  try {
    const userUuid = req.user.id;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 🛡️ Consolidated to NotificationLog (Directive #3)
    // Filter by userId (UUID) directly to ensure ownership, plus include 'all' for broadcasts
    const notifications = await prisma.notificationLog.findMany({
      where: {
        userId: { in: [userUuid, 'all'] },
        createdAt: { gte: thirtyDaysAgo }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    const mappedNotifications = notifications.map(notif => ({
      id: notif.id,
      userId: notif.userId,
      customerId: notif.customerId,
      orderId: notif.orderId,
      type: notif.type,
      title: notif.title,
      message: notif.body,
      status: notif.status,
      isRead: notif.status === 'READ' || notif.readAt !== null,
      createdAt: notif.createdAt
    }));

    res.json(mappedNotifications);
  } catch (error) {
    logger.error('Fetch my notifications error', { error: error.message, uuid: req.user.id });
    res.status(500).json({ error: 'Failed to fetch your notifications' });
  }
};

/**
 * 3. Mark Notification as Read
 */
exports.markAsRead = async (req, res) => {
  try {
    const logId = parseInt(req.params.id);
    if (isNaN(logId)) {
      return res.status(400).json({ error: 'معرّف غير صالح' });
    }

    // 🛡️ Identifier Consistency: Querying NotificationLog directly (Directive #5)
    const logEntry = await prisma.notificationLog.findUnique({
      where: { id: logId }
    });

    if (!logEntry) {
      return res.status(404).json({ error: 'التنبيه غير موجود' });
    }

    // 🛡️ SECURITY: Ownership Check (Prevents IDOR, permits broadcasts targeting 'all')
    if (req.user.role === 'customer' && logEntry.userId !== req.user.id && logEntry.userId !== 'all') {
      logger.security('Notification read attempt: Ownership violation', {
        logId,
        attemptedBy: req.user.id,
        ip: req.ip
      });
      return res.status(403).json({ error: 'غير مصرح لك بالوصول لهذا التنبيه' });
    }

    // Skip database write for broadcasts to preserve read status consistency for other users
    if (logEntry.userId !== 'all') {
      await prisma.notificationLog.update({
        where: { id: logId },
        data: { status: 'READ', readAt: new Date() }
      });
    }

    // 📡 [REALTIME-SYNC] Notify all active user sessions (Directive #4)
    const { SOCKET_EVENTS, SOCKET_ROOMS } = require('../shared/socketEvents');
    const io = require('../socket').getIO();
    if (io) {
      io.to(SOCKET_ROOMS.CUSTOMER(req.user.id)).emit(SOCKET_EVENTS.NOTIFICATION_READ, { logId });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Mark as read failed', { error: error.message, id: req.params.id });
    res.status(500).json({ error: 'Failed to mark as read' });
  }
};

/**
 * 4. Mark All as Read
 */
exports.markAllAsRead = async (req, res) => {
  try {
    const userUuid = req.user.id;
    
    // 🛡️ Strictly scoped to authenticated user context
    await prisma.notificationLog.updateMany({
      where: { 
        userId: userUuid, 
        status: { in: ['SENT', 'DELIVERED'] } 
      },
      data: { status: 'READ', readAt: new Date() }
    });

    // 📡 [REALTIME-SYNC] Global read synchronization (Directive #4)
    const { SOCKET_EVENTS, SOCKET_ROOMS } = require('../shared/socketEvents');
    const io = require('../socket').getIO();
    if (io) {
      io.to(SOCKET_ROOMS.CUSTOMER(userUuid)).emit(SOCKET_EVENTS.NOTIFICATION_READ_ALL, { timestamp: new Date() });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Mark all as read error', { error: error.message });
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
};

/**
 * 5. Create System Broadcast
 */
exports.broadcast = async (req, res) => {
  try {
    const { title, message } = req.body;
    const { publishEvent } = require('../events/eventPublisher');

    // 🛡️ Consolidated to NotificationLog
    const log = await prisma.notificationLog.create({
      data: { 
        title, 
        body: message, 
        type: 'broadcast', 
        userId: 'all', 
        status: 'PENDING' 
      }
    });

    await publishEvent({
      type: 'system.broadcast',
      aggregateId: log.id,
      payload: { title, message, metadata: { type: 'broadcast', logId: log.id.toString() } }
    });
    
    res.status(201).json(log);
  } catch (error) {
    logger.error('Broadcast error', { error: error.message });
    res.status(500).json({ error: 'Failed to broadcast' });
  }
};

/**
 * 6. Delete Notification
 */
exports.deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const logId = parseInt(id);
    const logEntry = await prisma.notificationLog.findUnique({ where: { id: logId } });

    if (!logEntry) return res.status(404).json({ error: 'Notification not found' });

    // 🛡️ SECURITY: Strict ownership verification
    if (req.user.role === 'customer' && logEntry.userId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.notificationLog.delete({ where: { id: logId } });
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete notification error', { error: error.message });
    res.status(500).json({ error: 'Failed to delete notification' });
  }
};

/**
 * 7. Test Diagnostic Push
 */
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
 * 8. Enterprise History Endpoint (Bilingual & Paged)
 * HARDENED: IDOR Protection & Role-based scoping.
 */
exports.getNotificationHistory = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, targetUserId } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

    // 🛡️ SECURITY: Strict IDOR Protection (Directive #4)
    // Only allow users to view their own history, or admins to view anyone's
    const requestedUser = targetUserId ? String(targetUserId) : req.user.id;
    
    if (requestedUser !== req.user.id && req.user.role !== 'admin') {
      logger.security('IDOR attempt blocked: Unauthorized history access', {
        requestedUser,
        attemptedBy: req.user.id
      });
      return res.status(403).json({ success: false, error: 'Access denied: Cannot view other users notifications.' });
    }

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
 * 9. markAsDelivered Lifecycle Hook
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
 * 10. Topic Lifecycle Management
 */
exports.manageTopicSubscription = async (req, res) => {
  try {
    const { action, topic } = req.body;
    if (!action || !['subscribe', 'unsubscribe'].includes(action.toLowerCase()) || !topic) {
      return res.status(400).json({ success: false, error: 'Invalid parameters.' });
    }

    const currentUserId = req.user.id;
    let resolvedToken = null;
    
    const custRecord = await prisma.customer.findUnique({ where: { uuid: currentUserId }, select: { fcmToken: true } });
    if (custRecord?.fcmToken) resolvedToken = custRecord.fcmToken;
    else {
      const userRecord = await prisma.user.findUnique({ where: { uuid: currentUserId }, select: { fcmToken: true } });
      if (userRecord?.fcmToken) resolvedToken = userRecord.fcmToken;
    }

    if (!resolvedToken) {
      return res.status(404).json({ success: false, error: 'No bound registration token found.' });
    }

    let executionSuccess = false;
    if (action.toLowerCase() === 'subscribe') {
      executionSuccess = await FirebaseService.subscribeToTopic(resolvedToken, topic);
    } else {
      executionSuccess = await FirebaseService.unsubscribeFromTopic(resolvedToken, topic);
    }

    res.status(200).json({ success: executionSuccess });
  } catch (error) {
    logger.error('Topic execution failure', { error: error.message });
    res.status(500).json({ success: false, error: 'Subscription transport failure' });
  }
};

/**
 * 11. sendSingleNotification Non-Blocking Diagnostic Helper
 */
exports.sendSingleNotification = async (req, res) => {
  try {
    const { userId, type, payload } = req.body;
    const customer = await prisma.customer.findUnique({
      where: { uuid: userId || '' },
      select: { fcmToken: true }
    });
    
    if (customer?.fcmToken) {
      FirebaseService.sendNotification({
        token: customer.fcmToken,
        type: type || 'order_ready',
        payload
      }).catch(err => {
        logger.warn('[NotificationController] sendSingleNotification non-blocking transport fault', { error: err.message });
      });
    }
    
    res.status(200).json({ success: true, message: 'Notification delivery dispatched' });
  } catch (error) {
    logger.error('sendSingleNotification endpoint error', { error: error.message });
    res.status(200).json({ success: true, message: 'Notification delivery skipped' });
  }
};
