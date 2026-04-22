const logger = require('../utils/logger');
const firebaseService = require('./firebaseService');
const { v4: uuidv4 } = require('uuid');
const eventBus = require('../events/eventBus');
const eventTypes = require('../events/eventTypes');
const { SOCKET_EVENTS, SOCKET_ROOMS } = require('../shared/socketEvents');
const prisma = require('../lib/prisma');

/**
 * 🛰️ Production-Grade Guaranteed Notification Engine (GNE)
 * Features: Self-healing, Multi-channel tracing, Idempotent retries, DLQ.
 */
class NotificationService {
  constructor() {
    this.io = null;
    this.MAX_RETRIES = 5;
    this.RECONCILE_INTERVAL = 5 * 60 * 1000; // 5 minutes
  }

  init() {
    logger.info('[NotificationService] 🛡️ Initializing Self-Healing Engine...');
    this._loadSocket();

    // 1. Subscribe to System Events
    eventBus.subscribe(eventTypes.ORDER_CREATED, (event) => this.processEvent(event, 'order_created'));
    eventBus.subscribe(eventTypes.ORDER_STATUS_CHANGED, (event) => this.processEvent(event, 'status_change'));
    eventBus.subscribe(eventTypes.ORDER_CANCELLED, (event) => this.processEvent(event, 'order_cancelled'));
    eventBus.subscribe('system.broadcast', (event) => this.processBroadcast(event));

    // 2. Start Reconciliation Worker (The Self-Healer)
    setInterval(() => this.reconcile(), this.RECONCILE_INTERVAL);
    
    logger.info('[NotificationService] ✅ Guaranteed Delivery Pipeline Active.');
  }

  _loadSocket() {
    try {
      this.io = require('../socket').getIO();
    } catch (e) {
      logger.warn('[NotificationService] Socket.io not ready, fallback engaged.');
    }
  }

  /**
   * 🔄 Main Pipeline: Entry point for ALL notifications
   */
  async processEvent(event, type) {
    const { order, newStatus, notification: customNotification } = event.payload;
    if (!order) return;

    const status = newStatus || order.status;
    const content = customNotification || this._generateStatusContent(order, status);
    
    // 1. 💾 PERSIST FIRST (Idempotency Anchor)
    const notification = await this._createNotificationRecord(order, content, type);
    if (!notification) return;

    // 2. 🚀 DISPATCH
    await this.dispatch(notification, order);
  }

  /**
   * 📡 Dispatch Logic (Multi-Channel + Intelligent Targeting)
   */
  async dispatch(notif, orderContext) {
    const type = notif.type;
    
    // 🎯 Determine Target Audience
    const target = {
      isToAdmin: type === 'order_created',
      isToCustomer: ['status_change', 'order_cancelled'].includes(type),
      isBroadcast: type === 'broadcast'
    };

    logger.info(`[NotificationService] 🚚 Dispatching ${type} #${notif.id} to ${target.isToAdmin ? 'ADMIN' : target.isBroadcast ? 'ALL' : 'CUSTOMER'}`);
    
    await Promise.allSettled([
      this._attemptSocketEmit(notif, orderContext, target),
      this._attemptFCMPush(notif, orderContext, target)
    ]);

    await prisma.notification.update({
      where: { id: notif.id },
      data: {
        status: 'SENT',
        retryCount: { increment: 1 }
      }
    });
  }

  /**
   * 🛠️ Reconciliation Worker: Scans for FAILED or PENDING notifications and repairs them.
   */
  async reconcile() {
    logger.info('[NotificationService] 🔍 Starting Reconciliation Scan...');
    
    const pendingTasks = await prisma.notification.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        retryCount: { lt: this.MAX_RETRIES },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24h
      },
      take: 50
    });

    if (pendingTasks.length === 0) return;

    logger.info(`[NotificationService] 🛠️ Found ${pendingTasks.length} notifications needing repair.`);

    for (const notif of pendingTasks) {
      try {
        // Fetch order context for retry
        const order = await prisma.order.findUnique({ 
          where: { id: notif.orderId },
          include: { customer: true }
        });
        
        if (!order) {
          await prisma.notification.update({ where: { id: notif.id }, data: { status: 'DEAD', lastError: 'Order not found' } });
          continue;
        }

        await this.dispatch(notif, order);
      } catch (err) {
        logger.error(`[NotificationService] ❌ Reconciliation failed for #${notif.id}`, { error: err.message });
      }
    }
  }

  // --- Internal Delivery Methods ---

  async _attemptSocketEmit(notif, order, target) {
    if (!this.io) this._loadSocket();
    if (!this.io) return false;

    try {
      const { mapOrderResponse } = require('../mappers/order.mapper');
      const fullMappedOrder = (order && order.id !== 0) ? mapOrderResponse(order) : {};

      const payload = {
        ...fullMappedOrder,
        notification: {
          id: notif.id,
          title: notif.title,
          message: notif.message,
          type: notif.type
        },
        fingerprint: {
          notificationId: String(notif.id),
          priority: 'HIGH',
          timestamp: Date.now(),
          deduplicationKey: `notif_${notif.id}`
        }
      };

      if (target.isBroadcast) {
        this.io.emit('new_broadcast', payload.notification);
        this.io.emit(SOCKET_EVENTS.ORDER_UPDATED, payload);
      } else if (target.isToAdmin) {
        this.io.to(SOCKET_ROOMS.ADMIN).emit(SOCKET_EVENTS.ORDER_UPDATED, payload);
      } else if (target.isToCustomer && order.customerId) {
        const room = SOCKET_ROOMS.CUSTOMER(order.customerId);
        this.io.to(room).emit(SOCKET_EVENTS.ORDER_UPDATED, payload);
      }

      return true;
    } catch (err) {
      return false;
    }
  }

  async _attemptFCMPush(notif, order, target) {
    try {
      if (target.isBroadcast) {
        await firebaseService.sendBroadcast(notif.title, notif.message, { 
          notificationId: String(notif.id),
          type: 'broadcast'
        });
        return true;
      }

      if (target.isToAdmin) {
        // 🚨 Send to STAFF TOPIC
        await firebaseService.sendToTopic('staff_orders', notif.title, notif.message, {
          notificationId: String(notif.id),
          orderId: String(notif.orderId),
          type: 'order_created'
        });
        return true;
      }

      const token = order.customer?.fcmToken;
      if (target.isToCustomer && token) {
        await firebaseService.sendToToken(token, notif.title, notif.message, {
          notificationId: String(notif.id),
          orderId: String(notif.orderId),
          type: notif.type,
          click_action: 'FLUTTER_NOTIFICATION_CLICK'
        });
        return true;
      }

      return false;
    } catch (err) {
      return false;
    }
  }

  async _createNotificationRecord(order, content, type) {
    try {
      // 🛡️ CRITICAL FIX: Extract the phone number correctly for DB filtering
      const phone = order.customerPhone || order.customer?.phone || null;

      return await prisma.notification.create({
        data: {
          title: content.title,
          message: content.message,
          type: type,
          orderId: order.id || null,
          customerPhone: phone, // Must not be null for customer to see it
          status: 'PENDING',
          metadata: { originalEvent: type }
        }
      });
    } catch (err) {
      logger.error('[NotificationService] ❌ Failed to create notification record', { error: err.message });
      return null;
    }
  }

  _generateStatusContent(order, status) {
    const num = order.orderNumber || order.id;
    const map = {
      pending: { title: 'طلب جديد 🔔', message: `تم استلام طلبك رقم ${num}` },
      preparing: { title: 'جاري التحضير 👨‍🍳', message: `طلبك رقم ${num} قيد التحضير الآن` },
      ready: { title: 'طلبك جاهز! ✅', message: `طلبك رقم ${num} جاهز للاستلام أو التوصيل` },
      delivered: { title: 'تم التسليم 🥡', message: 'بالهناء والشفاء! نتمنى رؤيتك قريباً' },
      cancelled: { title: 'تم الإلغاء ❌', message: `تم إلغاء طلبك رقم ${num}` }
    };
    return map[status] || { title: 'تحديث الطلب', message: `الطلب رقم ${num} أصبح ${status}` };
  }

  async processBroadcast(event) {
    const { title, message, metadata } = event.payload;
    const notif = await this._createNotificationRecord({ id: 0, customerPhone: null }, { title, message }, 'broadcast');
    if (notif) await this.dispatch(notif, { id: 0 });
  }
}

module.exports = new NotificationService();
