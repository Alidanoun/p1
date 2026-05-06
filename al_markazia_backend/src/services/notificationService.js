const { v4: uuidv4 } = require('uuid');

/**
 * 🛰️ Production-Grade Guaranteed Notification Engine (GNE)
 */
class NotificationService {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
    this.io = null;
    this.MAX_RETRIES = 5;
    this.RECONCILE_INTERVAL = 5 * 60 * 1000;
  }

  init() {
    this.logger.info('[NotificationService] 🛡️ Initializing Self-Healing Engine...');
    
    // Subscribe to System Events (using global eventBus for now as it's not in container yet)
    const eventBus = require('../events/eventBus');
    const eventTypes = require('../events/eventTypes');

    eventBus.subscribe(eventTypes.ORDER_CREATED, (event) => this.processEvent(event, 'order_created'));
    eventBus.subscribe(eventTypes.ORDER_STATUS_CHANGED, (event) => this.processEvent(event, 'status_change'));
    eventBus.subscribe(eventTypes.ORDER_CANCELLED, (event) => this.processEvent(event, 'order_cancelled'));
    eventBus.subscribe('system.broadcast', (event) => this.processBroadcast(event));
    eventBus.subscribe('loyalty.happy_hour_activated', (event) => this.processBroadcast(event));
    eventBus.subscribe('RESTAURANT_OPENED', () => this.notifySubscribersOfReopening(true));

    setInterval(() => this.reconcile(), this.RECONCILE_INTERVAL);
  }

  _getIO() {
    if (this.io) return this.io;
    try {
      this.io = require('../socket').getIO();
      return this.io;
    } catch (e) {
      return null;
    }
  }

  async processEvent(event, type) {
    const { order, newStatus, notification: customNotification } = event.payload;
    if (!order) return;
    const status = newStatus || order.status;
    const content = customNotification || this._generateStatusContent(order, status);
    const notification = await this._createNotificationRecord(order, content, type);
    if (!notification) return;
    await this.dispatch(notification, order);
  }

  async sendToUser(customerId, content) {
    const user = await this.prisma.customer.findUnique({ 
      where: { uuid: customerId },
      select: { id: true, phone: true }
    });
    if (!user) return;

    const notif = await this._createNotificationRecord(
      { id: content.orderId || 0, customer: { phone: user.phone } }, 
      content, 
      content.type || 'direct'
    );

    if (notif) {
      const orderContext = content.orderId ? 
        await this.prisma.order.findUnique({ where: { id: content.orderId }, include: { customer: true } }) : 
        { id: 0, customerId: user.id };
      await this.dispatch(notif, orderContext);
    }
  }

  async dispatch(notif, orderContext) {
    const type = notif.type;
    const EXEC_EVENTS = ['order_created', 'order_cancelled', 'status_change', 'order_updated', 'order_assigned'];
    const MONITOR_EVENTS = ['order_created', 'order_cancelled', 'status_change', 'order_updated'];
    const CUSTOMER_EVENTS = ['order_created', 'status_change', 'order_cancelled', 'payment_status', 'delivery_updated'];
    
    const target = {
      isToAdmin: EXEC_EVENTS.includes(type) || MONITOR_EVENTS.includes(type),
      isToCustomer: CUSTOMER_EVENTS.includes(type),
      isBroadcast: type === 'broadcast'
    };

    await Promise.allSettled([
      this._attemptSocketEmit(notif, orderContext, target),
      this._attemptFCMPush(notif, orderContext, target)
    ]);

    await this.prisma.notification.update({
      where: { id: notif.id },
      data: { status: 'SENT', retryCount: { increment: 1 } }
    });
  }

  async reconcile() {
    const pendingTasks = await this.prisma.notification.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        retryCount: { lt: this.MAX_RETRIES },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      },
      take: 50
    });

    for (const notif of pendingTasks) {
      try {
        const orderId = parseInt(notif.orderId);
        if (isNaN(orderId)) continue;
        const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });
        if (order) await this.dispatch(notif, order);
      } catch (err) {
        await this.prisma.notification.update({ where: { id: notif.id }, data: { retryCount: { increment: 1 }, lastError: err.message } });
      }
    }
    await this.notifySubscribersOfReopening();
  }

  async notifySubscribersOfReopening(forceAll = false) {
    const firebaseService = require('./firebaseService'); // Fallback for now
    const now = new Date();
    const where = forceAll ? { notified: false } : { notified: false, targetTime: { lte: now } };
    const subs = await this.prisma.restaurantSubscription.findMany({ where, take: 100 });

    for (const sub of subs) {
      try {
        await firebaseService.sendToToken(sub.fcmToken, "🎉 نـحـن بـانـتـظـاركـم!", "تم فتح المطعم الآن...", { type: 'RESTAURANT_OPENED' });
        await this.prisma.restaurantSubscription.update({ where: { id: sub.id }, data: { notified: true } });
      } catch (e) {
        logger.logError('NotificationService.notifySubscribersOfReopening', e, { subId: sub.id });
      }
    }
  }

  async _attemptSocketEmit(notif, order, target) {
    const io = this._getIO();
    if (!io) return false;

    const { mapOrderResponse } = require('../mappers/order.mapper');
    const { SOCKET_EVENTS } = require('../shared/socketEvents');
    const payload = {
      ...((order && order.id !== 0) ? mapOrderResponse(order) : {}),
      id: String(notif.id),
      notification: { title: notif.title, message: notif.message },
      timestamp: Date.now()
    };

    if (target.isBroadcast) {
      io.emit(SOCKET_EVENTS.NOTIFICATION_NEW, this.container.securityPolicyService.wrapPayload(payload));
    }
    
    const eventMeta = {
      type: notif.type,
      branchId: order?.branchId || null,
      customerUuid: order?.customer?.uuid || order?.customerId
    };

    const targetRooms = await this.container.securityPolicyService.getTargetRooms(eventMeta);
    
    if (target.isToAdmin) {
      const execEvent = SOCKET_EVENTS.EXEC_ORDER_UPDATED;
      const finalPayload = this.container.securityPolicyService.wrapPayload(payload);
      targetRooms.forEach(room => io.to(room).emit(execEvent, finalPayload));
    }
    
    if (target.isToCustomer && eventMeta.customerUuid) {
      const { SOCKET_ROOMS } = require('../shared/socketEvents');
      io.to(SOCKET_ROOMS.CUSTOMER(eventMeta.customerUuid)).emit(SOCKET_EVENTS.CUSTOMER_ORDER_UPDATED, this.container.securityPolicyService.wrapPayload(payload));
    }
    return true;
  }

  async _attemptFCMPush(notif, order, target) {
    const firebaseService = require('./firebaseService');
    if (target.isBroadcast) {
      await firebaseService.sendBroadcast(notif.title, notif.message, { type: 'broadcast' });
    } else if (target.isToAdmin) {
      await firebaseService.sendToTopic('staff_orders', notif.title, notif.message, { type: 'order_created' });
    } else if (target.isToCustomer && order.customer?.fcmToken) {
      await firebaseService.sendToToken(order.customer.fcmToken, notif.title, notif.message, { type: notif.type });
    }
  }

  async _createNotificationRecord(order, content, type) {
    const phone = order.customerPhone || order.customer?.phone || null;
    return await this.prisma.notification.create({
      data: {
        title: content.title, message: content.message, type: type,
        orderId: order.id ? parseInt(order.id) : null, customerPhone: phone, status: 'PENDING'
      }
    });
  }

  _generateStatusContent(order, status) {
    const num = order.orderNumber || order.id;
    const map = {
      pending: { title: 'طلب جديد 🔔', message: `تم استلام طلبك رقم ${num}` },
      preparing: { title: 'جاري التحضير 👨‍🍳', message: `طلبك رقم ${num} قيد التحضير الآن` },
      ready: { title: 'طلبك جاهز! ✅', message: `طلبك رقم ${num} جاهز للاستلام أو التوصيل` },
      delivered: { title: 'تم التسليم 🥡', message: 'بالهناء والشفاء! شكراً لطلبك من المركزية' },
      cancelled: { title: 'تم الإلغاء ❌', message: `تم إلغاء طلبك رقم ${num}` }
    };
    return map[status] || { title: 'تحديث الطلب', message: `الطلب رقم ${num} أصبح ${status}` };
  }

  async processBroadcast(event) {
    const { title, message } = event.payload;
    const notif = await this._createNotificationRecord({ id: 0 }, { title, message }, 'broadcast');
    if (notif) await this.dispatch(notif, { id: 0 });
  }
}

// --- 🛡️ Backward Compatibility ---
const getContainer = () => require('../lib/container');
const proxy = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'NotificationService') return NotificationService;
    const service = getContainer().notificationService;
    const val = service[prop];
    return typeof val === 'function' ? val.bind(service) : val;
  }
});

module.exports = proxy;
module.exports.NotificationService = NotificationService;
