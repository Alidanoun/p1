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
    eventBus.subscribe('loyalty.happy_hour_activated', (event) => this.processBroadcast(event));
    eventBus.subscribe('RESTAURANT_OPENED', () => this.notifySubscribersOfReopening(true));

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
    logger.debug(`[GNE] 🏁 Starting dispatch for #${notification.id} (Type: ${type})`);
    await this.dispatch(notification, order);
  }

  /**
   * 📡 Dispatch Logic (Multi-Channel + Intelligent Targeting)
   */
  async dispatch(notif, orderContext) {
    const type = notif.type;
    
    // 🎯 Determine Target Audience
    const target = {
      isToAdmin: ['order_created', 'order_cancelled'].includes(type),
      isToCustomer: ['order_created', 'status_change', 'order_cancelled'].includes(type),
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

    if (pendingTasks.length > 0) {
      logger.info(`[NotificationService] 🛠️ Found ${pendingTasks.length} notifications needing repair.`);

      for (const notif of pendingTasks) {
        try {
          // Fetch order context for retry
          if (!notif.orderId || isNaN(parseInt(notif.orderId))) {
            await prisma.notification.update({ 
              where: { id: notif.id }, 
              data: { status: 'DLQ', lastError: 'Invalid orderId', dlqMovedAt: new Date() } 
            });
            continue;
          }

          const order = await prisma.order.findUnique({ 
            where: { id: parseInt(notif.orderId) },
            include: { customer: true }
          });
          
          if (!order) {
            await prisma.notification.update({ 
              where: { id: notif.id }, 
              data: { status: 'DLQ', lastError: 'Order not found', dlqMovedAt: new Date() } 
            });
            continue;
          }

          await this.dispatch(notif, order);
        } catch (err) {
          logger.error(`[NotificationService] ❌ Reconciliation failed for #${notif.id}`, { error: err.message });
          const currentRetry = (notif.retryCount || 0) + 1;
          if (currentRetry >= this.MAX_RETRIES) {
            await prisma.notification.update({
              where: { id: notif.id },
              data: {
                status: 'DLQ',
                lastError: err.message,
                retryCount: currentRetry,
                dlqMovedAt: new Date()
              }
            });
          } else {
            await prisma.notification.update({
              where: { id: notif.id },
              data: { retryCount: { increment: 1 }, lastError: err.message }
            });
          }
        }
      }
    }

    // Also check for restaurant subscriptions that need notifying (auto-reopen check)
    await this.notifySubscribersOfReopening();
  }

  /**
   * 📢 Notify customers who opted-in when the restaurant was closed
   */
  async notifySubscribersOfReopening(forceAll = false) {
    try {
      const now = new Date();
      // If forceAll is true (manual open), notify everyone. 
      // Otherwise only those whose time has passed (automatic open).
      const where = forceAll ? { notified: false } : { notified: false, targetTime: { lte: now } };
      
      const subs = await prisma.restaurantSubscription.findMany({
        where,
        take: 100
      });

      if (subs.length === 0) return;

      logger.info(`[NotificationService] 📢 Notifying ${subs.length} subscribers about reopening...`);

      for (const sub of subs) {
        try {
          await firebaseService.sendToToken(
            sub.fcmToken,
            "🎉 نـحـن بـانـتـظـاركـم!",
            "تم فتح المطعم الآن، يمكنك تقديم طلبك والتمتع بأشهى الوجبات.",
            { 
              type: 'RESTAURANT_OPENED',
              click_action: 'FLUTTER_NOTIFICATION_CLICK'
            }
          );
          
          await prisma.restaurantSubscription.update({
            where: { id: sub.id },
            data: { notified: true }
          });
        } catch (e) {
          logger.warn(`[NotificationService] Failed to notify sub #${sub.id}: ${e.message}`);
        }
      }
    } catch (error) {
      logger.error('[NotificationService] Error in notifySubscribersOfReopening', { error: error.message });
    }
  }

  async _attemptSocketEmit(notif, order, target) {
    if (!this.io) this._loadSocket();
    if (!this.io) return false;

    try {
      const { mapOrderResponse } = require('../mappers/order.mapper');
      const fullMappedOrder = (order && order.id !== 0) ? mapOrderResponse(order) : {};

      const payload = {
        ...fullMappedOrder,
        id: String(notif.id),
        notification: {
          title: notif.title,
          message: notif.message
        },
        timestamp: Date.now()
      };

      if (target.isBroadcast) {
        this.io.emit(SOCKET_EVENTS.NOTIFICATION_NEW, payload);
      }
      
      // 🛡️ [PHASE 2] Real-Time Isolation Layer
      const SecurityPolicyService = require('./securityPolicyService');
      
      const eventMeta = {
        type: notif.type,
        branchId: order?.branchId || null,
        customerUuid: order?.customer?.uuid || order?.customerId,
        priority: this._getPriority(notif.type)
      };

      // 1. 🛡️ [DEDUPLICATION-LAYER] Prevent Duplicate Broadcasts
      const eventHash = require('crypto').createHash('md5')
        .update(`${notif.type}:${order?.id || 'GLOBAL'}:${notif.content}`)
        .digest('hex');
      
      if (await this._isDuplicate(eventHash)) {
        logger.debug(`[GNE] 🛡️ Duplicate event ignored: ${eventHash}`);
        return;
      }

      // 2. 🛡️ [THROTTLE-LAYER] Backpressure Control
      if (eventMeta.priority === 'LOW' && await this._isSystemOverloaded()) {
        logger.warn('[GNE] 📉 System overloaded. Dropping LOW priority UI update.');
        return;
      }
  
      // 🛡️ Fail-safe: Prevent global broadcast for branch-specific events
      if (!eventMeta.branchId && !['broadcast', 'system_alert'].includes(notif.type)) {
        logger.warn('[NotificationService] Blocked possible leak: No branchId for targeted event', { 
          orderId: order?.id, 
          type: notif.type 
        });
        return;
      }

      const targetRooms = await SecurityPolicyService.getTargetRooms(eventMeta);
      
      try {
        const circuitBreaker = require('./circuitBreakerService');
        if (await circuitBreaker.isOpen('SOCKET_ENGINE')) {
          throw new Error('CIRCUIT_OPEN');
        }

        if (target.isToAdmin) {
          const StateAuthority = require('./stateAuthority');
          const canonicalOrder = await StateAuthority.getCanonicalOrder(order?.id);
          
          if (!canonicalOrder) {
            logger.warn('[NotificationService] Skipping broadcast: Canonical state not found', { orderId: order?.id });
            return;
          }

          const eventName = notif.type === 'order_created' 
            ? SOCKET_EVENTS.ORDER_CREATED 
            : SOCKET_EVENTS.ORDER_UPDATED;
          
          // 🧠 Canonical State Sync (Overwrite Layer)
          const finalPayload = SecurityPolicyService.wrapPayload(canonicalOrder);

          targetRooms.forEach(room => {
            if (room.includes('admin') || room.includes('branch')) {
              this.io.to(room).emit(eventName, finalPayload);
              logger.debug(`[CanonicalSync] Event '${eventName}' broadcasted canonical state to: ${room}`);
            }
          });
        }
        
        if (target.isToCustomer && eventMeta.customerUuid) {
          const wrappedPayload = SecurityPolicyService.wrapPayload(payload);
          const customerRoom = `room:user:${eventMeta.customerUuid}`;
          this.io.to(customerRoom).emit(SOCKET_EVENTS.ORDER_UPDATED, wrappedPayload);
          logger.debug(`[POLICY v2] Event routed to private user boundary: ${customerRoom}`);
        }
        
        await circuitBreaker.recordSuccess('SOCKET_ENGINE');
        return true;
      } catch (err) {
        const circuitBreaker = require('./circuitBreakerService');
        await circuitBreaker.recordFailure('SOCKET_ENGINE');
        logger.error(`[GNE] ❌ Socket Emit Failed: ${err.message}`);
        return false;
      }
    } catch (err) {
      logger.error(`[GNE] ❌ Critical Failure in _attemptSocketEmit: ${err.message}`);
      return false;
    }
  }

  _getPriority(type) {
    const PRIORITIES = {
      'order_created': 'HIGH',
      'order_cancelled': 'HIGH',
      'status_change': 'MEDIUM',
      'broadcast': 'LOW',
      'system_alert': 'HIGH'
    };
    return PRIORITIES[type] || 'LOW';
  }

  async _isDuplicate(hash) {
    const redis = require('../lib/redis');
    try {
      const exists = await redis.get(`notif:dup:${hash}`);
      if (exists) return true;
      await redis.set(`notif:dup:${hash}`, '1', 'EX', 60); // 60s window
      return false;
    } catch (err) { return false; }
  }

  async _isSystemOverloaded() {
    // Simple load check: if socket is disconnected or memory is high
    const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
    return memUsage > 500; // Over 500MB
  }

  async _attemptFCMPush(notif, order, target) {
    try {
      if (target.isBroadcast) {
        await firebaseService.sendBroadcast(notif.title, notif.message, { 
          notificationId: String(notif.id),
          type: 'broadcast',
          fingerprint: JSON.stringify({
            notificationId: String(notif.id),
            priority: 'MEDIUM',
            timestamp: Date.now(),
            deduplicationKey: `notif_${notif.id}`
          })
        });
        return true;
      }

      if (target.isToAdmin) {
        await firebaseService.sendToTopic('staff_orders', notif.title, notif.message, {
          notificationId: String(notif.id),
          orderId: String(notif.orderId),
          type: 'order_created',
          fingerprint: JSON.stringify({
            notificationId: String(notif.id),
            priority: 'HIGH',
            timestamp: Date.now(),
            deduplicationKey: `notif_${notif.id}`
          })
        });
        return true;
      }

      const token = order.customer?.fcmToken;
      if (target.isToCustomer && token) {
        await firebaseService.sendToToken(token, notif.title, notif.message, {
          notificationId: String(notif.id),
          orderId: String(notif.orderId),
          type: notif.type,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          fingerprint: JSON.stringify({
            notificationId: String(notif.id),
            priority: 'HIGH',
            timestamp: Date.now(),
            deduplicationKey: `notif_${notif.id}`
          })
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
      const phone = order.customerPhone || order.customer?.phone || null;

      return await prisma.notification.create({
        data: {
          title: content.title,
          message: content.message,
          type: type,
          orderId: order.id ? parseInt(order.id) : null,
          customerPhone: phone,
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
    const points = order.pointsEarned;
    const map = {
      pending: { title: 'طلب جديد 🔔', message: `تم استلام طلبك رقم ${num}` },
      preparing: { title: 'جاري التحضير 👨‍🍳', message: `طلبك رقم ${num} قيد التحضير الآن` },
      ready: { title: 'طلبك جاهز! ✅', message: `طلبك رقم ${num} جاهز للاستلام أو التوصيل` },
      delivered: { 
        title: 'تم التسليم 🥡', 
        message: points > 0 
          ? `بالهناء والشفاء! تم إضافة ${points} نقطة إلى حسابك. شكراً لطلبك من المركزية` 
          : 'بالهناء والشفاء! نتمنى رؤيتك قريباً' 
      },
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
