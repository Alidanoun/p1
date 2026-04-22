
const prisma = require('../lib/prisma');
const socketIo = require('../socket');
const firebaseService = require('../services/firebaseService');
const logger = require('../utils/logger');

exports.getNotifications = async (req, res) => {
  try {
    const { phone } = req.query; 

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let whereClause = {
      createdAt: { gte: thirtyDaysAgo }
    };

    if (phone) {
      logger.deprecate('Access to phone-based getNotifications detected', { phone });
      // Customer getting their notifications + broadcasts
      whereClause = { 
        ...whereClause,
        OR: [
          { customerPhone: phone },
          { type: 'broadcast' }
        ]
       };
    } else {
      // Admin getting admin notifications (customerPhone null and not broadcast)
      whereClause = { 
        ...whereClause,
        customerPhone: null,
        type: { not: 'broadcast' }
      };
    }

    const notifications = await prisma.notification.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: 100 // Limit to latest 100
    });

    res.json(notifications);
  } catch (error) {
    logger.error('Fetch notifications error', { error: error.message, stack: error.stack, phone: req.query.phone });
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

/**
 * Enterprise Identity Layer: Securely fetch authenticated customer notifications
 * Uses req.user.id (UUID) instead of phone number to prevent IDOR.
 */
exports.getMyNotifications = async (req, res) => {
  try {
    const userUuid = req.user.id;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Find the customer record by UUID to get their phone
    const customer = await prisma.customer.findUnique({ where: { uuid: userUuid } });
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
    const { id } = req.params;
    await prisma.notification.update({
      where: { id: parseInt(id) },
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to mark notification as read', { error: error.message, id: req.params.id });
    res.status(500).json({ error: 'Failed to mark as read' });
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    let whereClause = {};

    if (req.user && req.user.role === 'customer') {
      // Authenticated Path: Load phone from UUID
      const customer = await prisma.customer.findUnique({ where: { uuid: req.user.id } });
      if (!customer) return res.status(404).json({ error: 'Customer not found' });
      whereClause = { customerPhone: customer.phone, isRead: false };
    } else if (req.query.phone) {
      // Legacy Path: Still support phone-based for now (until cutover)
      whereClause = { customerPhone: req.query.phone, isRead: false };
    } else {
      // Admin Path
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

exports.broadcast = async (req, res) => {
  try {
    const { title, message } = req.body;
    const { publishEvent } = require('../events/eventPublisher');

    const notification = await prisma.notification.create({
      data: {
        title,
        message,
        type: 'broadcast',
      }
    });

    // 📣 NEW: Publish to Event System (The Root Solution)
    await publishEvent({
      type: 'system.broadcast',
      aggregateId: notification.id,
      payload: {
        title,
        message,
        metadata: {
          type: 'broadcast',
          id: notification.id.toString(),
          createdAt: notification.createdAt.toISOString()
        }
      }
    });

    // Still emit socket for admin dashboard sync
    const io = socketIo.getIO();
    if (io) io.emit('new_broadcast', notification);

    logger.info('Broadcast event published', { title, notificationId: notification.id });
    res.status(201).json(notification);
  } catch (error) {
    logger.error('Broadcast error', { error: error.message, body: req.body });
    res.status(500).json({ error: 'Failed to broadcast notification' });
  }
};

// --- Automated Cleanup Task ---
// Runs every 24 hours to permanently delete notifications older than 30 days
setInterval(async () => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const deletedCount = await prisma.notification.deleteMany({
      where: {
        createdAt: { lt: thirtyDaysAgo }
      }
    });

    if (deletedCount.count > 0) {
      logger.info(`🧹 Cleanup: Deleted ${deletedCount.count} expired notifications.`);
    }
  } catch (error) {
    logger.error('❌ Cleanup Task Error', { error: error.message });
  }
}, 24 * 60 * 60 * 1000); // 24 Hours
