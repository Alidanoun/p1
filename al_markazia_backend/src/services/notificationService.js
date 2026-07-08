const { v4: uuidv4 } = require('uuid');
const notificationPolicyService = require('./notificationPolicyService');
const { notificationPayloadSchema } = require('./validators/notificationPayload.schema');
const xss = require('xss');

/**
 * 🛰️ Production-Grade Guaranteed Notification Engine (GNE)
 * Hardened SDS 3.1: NotificationLog is now the Single Source of Truth.
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
    this.logger.info('[NotificationService] 🛡️ Initializing Self-Healing Engine (Targeting NotificationLog SSOT)...');
    
    const eventBus = require('../events/eventBus');
    
    // Broadcasts and maintenance re-opening are processed cleanly
    eventBus.subscribe('system.broadcast', (event) => this.processBroadcast(event));
    eventBus.subscribe('loyalty.happy_hour_activated', (event) => this.processBroadcast(event));
    eventBus.subscribe('RESTAURANT_OPENED', () => this.notifySubscribersOfReopening(true));

    // Automated periodic retry reconciliation checks remain as a safety net for fallback processing
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
      select: { id: true, phone: true, uuid: true }
    });
    if (!user) return;

    const notif = await this._createNotificationRecord(
      { id: content.orderId || 0, customer: user }, 
      content, 
      content.type || 'direct'
    );

    if (notif) {
      const orderContext = content.orderId ? 
        await this.prisma.order.findUnique({ where: { id: content.orderId }, include: { customer: true } }) : 
        { id: 0, customerId: user.id, customer: user };
      await this.dispatch(notif, orderContext);
    }
  }

  async dispatch(notif, orderContext) {
    try {
      const type = notif.type;
      
      let userId = orderContext?.customer?.uuid || notif.userId || orderContext?.customerId || orderContext?.customer?.id;
      if (userId === null) userId = undefined;

      // 1. Zod Validation (Phase 1)
      const validationResult = notificationPayloadSchema.safeParse({
        type: this._mapToSchemaType(type),
        title: notif.title,
        body: notif.body,
        userId: userId,
        data: { orderId: orderContext?.id }
      });

      if (!validationResult.success) {
        this.logger.error('[NotificationService] Payload validation failed', { errors: validationResult.error.errors });
        return;
      }

      // 2. Policy Evaluation (Phase 1: Preferences, Quiet Hours)
      if (userId && type !== 'broadcast') {
        const identityType = orderContext?.customer ? 'customer' : 'user';
        const policy = await notificationPolicyService.evaluate(userId, this._mapToSchemaType(type), identityType);
        if (!policy.allowed) {
          this.logger.info(`[NotificationService] Skip dispatch: ${policy.reason}`, { userId, type, identityType });
          return;
        }
      }

      const EXEC_EVENTS = ['order_created', 'order_cancelled', 'status_change', 'order_updated', 'order_assigned'];
      const MONITOR_EVENTS = ['order_created', 'order_cancelled', 'status_change', 'order_updated'];
      const CUSTOMER_EVENTS = ['order_created', 'status_change', 'order_cancelled', 'payment_status', 'delivery_updated'];
      
      const target = {
        isToAdmin: EXEC_EVENTS.includes(type) || MONITOR_EVENTS.includes(type),
        isToCustomer: CUSTOMER_EVENTS.includes(type),
        isBroadcast: type === 'broadcast' || type === 'system.broadcast'
      };

      await this._attemptFCMPush(notif, orderContext, target);

      // 📡 [REALTIME-SYNC] Emit notification via Socket.io
      const io = this._getIO();
      if (io) {
        const socketPayload = {
          id: notif.id,
          type: notif.type || 'broadcast',
          title: notif.title,
          message: notif.body,
          isRead: false,
          createdAt: notif.createdAt || new Date()
        };

        const branchPolicy = require('../policies/branchPolicy');
        const wrappedPayload = branchPolicy.wrapPayload(socketPayload);
        
        if (target.isBroadcast) {
          io.emit('notification:new', wrappedPayload);
        } else {
          const rooms = await branchPolicy.getTargetRooms({ 
            type: notif.type, 
            branchId: orderContext?.branchId, 
            customerUuid: userId 
          });
          rooms.forEach(room => {
            io.to(room).emit('notification:new', wrappedPayload);
          });
        }
      }

      await this.prisma.notificationLog.update({
        where: { id: notif.id },
        data: { status: 'SENT', sentAt: new Date(), retries: { increment: 1 } }
      });
    } catch (err) {
      this.logger.error('[NotificationService] Dispatch error', { error: err.message });
      await this.prisma.notificationLog.update({
        where: { id: notif.id },
        data: { status: 'FAILED', error: err.message, retries: { increment: 1 } }
      }).catch(() => {});
    }
  }

  _mapToSchemaType(type) {
    const map = {
      'order_created': 'ORDER_NEW',
      'status_change': 'ORDER_STATUS_UPDATE',
      'payment_status': 'PAYMENT_SUCCESS',
      'broadcast': 'PROMOTION',
      'system.broadcast': 'PROMOTION',
      'system_alert': 'SYSTEM_ALERT'
    };
    return map[type] || 'SYSTEM_ALERT';
  }

  async reconcile() {
    this.logger.info('[NotificationService] 🔄 Starting Reconciliation Job (NotificationLog)...');
    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;

    // 🛡️ Sweeps pending/failed rows in NotificationLog
    const pendingTasks = await this.prisma.notificationLog.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        retries: { lt: this.MAX_RETRIES },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      },
      take: 50
    });

    for (const notif of pendingTasks) {
      try {
        const orderId = notif.orderId;
        if (!orderId) {
          if (notif.type === 'broadcast' || notif.type === 'system.broadcast') {
            await this.dispatch(notif, { id: 0 });
            successCount++;
          } else {
            await this.prisma.notificationLog.update({ where: { id: notif.id }, data: { status: 'SENT' } });
          }
          continue;
        }

        const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });
        if (order) {
          await this.dispatch(notif, order);
          successCount++;
        } else {
          await this.prisma.notificationLog.update({ where: { id: notif.id }, data: { status: 'SENT' } });
        }
      } catch (err) {
        failCount++;
      }
    }
    
    this.logger.info('[NotificationService] ✅ Reconciliation Complete', { 
      duration: `${Date.now() - startTime}ms`,
      processed: pendingTasks.length,
      success: successCount,
      failed: failCount
    });
    
    await this.notifySubscribersOfReopening().catch(e => this.logger.error('[NotificationService] notify reopening error', { error: e.message }));
  }

  async notifySubscribersOfReopening(forceAll = false) {
    const firebaseService = require('./firebaseService');
    const now = new Date();
    const where = forceAll ? { notified: false } : { notified: false, targetTime: { lte: now } };
    const subs = await this.prisma.restaurantSubscription.findMany({ where, take: 100 });
    if (subs.length === 0) return;
    
    // ✅ [FIX] تصفية الرموز الصالحة مرة واحدة
    const validSubs = subs.filter(s => s.fcmToken && s.fcmToken.trim().length > 0);
    const tokens = validSubs.map(s => s.fcmToken);
    if (tokens.length === 0) return;
    
    // ✅ إرسال واحد لـ Firebase بدلاً من N طلبات
    const { getMessaging } = require('firebase-admin/messaging');
    const batchResponse = await getMessaging().sendEachForMulticast({
      tokens,
      notification: {
        title: '🎉 نـحـن بـانـتـظـاركـم!',
        body: 'تم فتح المطعم الآن، اطلب الآن!'
      },
      data: { type: 'RESTAURANT_OPENED' },
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } }
    });
    
    // ✅ تحديد من نجح ومن فشل
    const successfulIds = [];
    const failedTokens = [];
    batchResponse.responses.forEach((resp, idx) => {
      if (resp.success) {
        successfulIds.push(validSubs[idx].id);
      } else {
        failedTokens.push(validSubs[idx].id);
        this.logger.warn('FCM token failed during reopening notify', { subId: validSubs[idx].id, error: resp.error?.code });
      }
    });
    
    // ✅ تحديث DB دفعة واحدة بدلاً من N استعلامات
    if (successfulIds.length > 0) {
      await this.prisma.restaurantSubscription.updateMany({
        where: { id: { in: successfulIds } },
        data: { notified: true }
      });
    }
  }

  async _attemptFCMPush(notif, order, target) {
    const firebaseService = require('./firebaseService');
    const { fcmBreaker } = require('../middleware/notificationCircuitBreaker');

    if (target.isBroadcast) {
      await fcmBreaker.fire(firebaseService.sendBroadcast.bind(firebaseService), notif.title, notif.body, { type: 'broadcast', logId: String(notif.id) });
    } else {
      const promises = [];
      const targets = [];
      
      if (target.isToAdmin && notif.userId === 'admin') {
        promises.push(
          fcmBreaker.fire(firebaseService.sendToTopic.bind(firebaseService), 'staff_orders', notif.title, notif.body, { type: 'order_created', logId: String(notif.id) })
        );
        targets.push('admin');
      }
      
      if (target.isToCustomer && notif.userId !== 'admin' && order.customer?.fcmToken) {
        promises.push(
          fcmBreaker.fire(firebaseService.sendToToken.bind(firebaseService), order.customer.fcmToken, notif.title, notif.body, { type: notif.type, logId: String(notif.id) })
        );
        targets.push('customer');
      }
      
      if (promises.length > 0) {
        const results = await Promise.allSettled(promises);
        const errors = [];
        results.forEach((res, index) => {
          if (res.status === 'rejected') {
            errors.push(`${targets[index]}: ${res.reason?.message || res.reason}`);
          } else if (res.value === null) {
            errors.push(`${targets[index]}: Delivery returned null`);
          }
        });
        if (errors.length > 0) {
          throw new Error(errors.join('; '));
        }
      }
    }
  }

  /**
   * 📬 Direct Multi-Channel Notification (Manual)
   */
  async sendDirectNotification(phone, title, message, metadata = {}) {
    try {
      const safeTitle = title ? xss(String(title), { whiteList: {} }) : '';
      const safeMessage = message ? xss(String(message), { whiteList: {} }) : '';

      const customer = await this.prisma.customer.findFirst({ where: { phone } });

      const notification = await this.prisma.notificationLog.create({
        data: {
          userId: customer?.uuid || null,
          customerId: customer?.id || null,
          title: safeTitle,
          body: safeMessage,
          type: metadata.type || 'SYSTEM_ALERT',
          status: 'PENDING'
        }
      });

      // Attempt immediate delivery
      const firebaseService = require('./firebaseService');
      const { fcmBreaker } = require('../middleware/notificationCircuitBreaker');
      
      if (customer?.fcmToken) {
        await fcmBreaker.fire(firebaseService.sendToToken.bind(firebaseService), customer.fcmToken, safeTitle, safeMessage, { ...metadata, logId: String(notification.id) });
        await this.prisma.notificationLog.update({ where: { id: notification.id }, data: { status: 'SENT', sentAt: new Date() } });
      }

      return notification;
    } catch (err) {
      this.logger.error('[NotificationService] Direct notification failed', { phone, error: err.message });
    }
  }

  async _createNotificationRecord(order, content, type) {
    const userId = order.customer?.uuid || null;
    const safeTitle = content.title ? xss(String(content.title), { whiteList: {} }) : '';
    const safeMessage = content.message ? xss(String(content.message), { whiteList: {} }) : '';
    
    return await this.prisma.notificationLog.create({
      data: {
        userId: userId,
        customerId: order.customerId || order.customer?.id || null,
        orderId: order.id ? parseInt(order.id) : null,
        title: safeTitle,
        body: safeMessage,
        type: type,
        status: 'PENDING'
      }
    });
  }

  _generateStatusContent(order, status) {
    const rawNum = order.orderNumber || String(order.id);
    const shortNum = rawNum.replace(/^AMM-\d+-/, '').replace(/-FB$/, '');
    const num = `#${shortNum}`;
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
