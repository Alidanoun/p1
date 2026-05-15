const StreamConsumerGroup = require('../streamConsumerGroup');
const container = require('../../lib/container');
const logger = require('../../utils/logger');

/**
 * 🥇 Priority 1 Stream Consumer: Notification Engine
 * Hardened SDS 3.1: Guaranteed Delivery Model.
 * 
 * REMOVAL OF SHADOW QUEUE:
 * We no longer use internalFCMQueue (in-memory).
 * Deliveries are now performed synchronously within the consumer loop.
 * ACK (XACK) only happens AFTER Firebase/External delivery success.
 */
const notificationEngineConsumer = new StreamConsumerGroup(
  'cg:notification_engine',
  `worker-${process.env.INSTANCE_ID || 'node-1'}`,
  {
    '*': async (event) => {
      const { type, payload } = event;
      const notificationService = container.notificationService;
      const firebaseService = require('../../services/firebaseService');
      
      if (!notificationService) return;

      // 1. Extract context details
      let orderId = payload?.id || payload?.orderId || null;
      let orderContext = null;

      if (orderId && !isNaN(parseInt(orderId))) {
        orderContext = await container.prisma.order.findUnique({
          where: { id: parseInt(orderId) },
          include: { customer: true }
        });
      }

      // 2. Map evaluation target mapping
      const EXEC_EVENTS = ['order_created', 'order_cancelled', 'status_change', 'order_updated', 'order_assigned'];
      const MONITOR_EVENTS = ['order_created', 'order_cancelled', 'status_change', 'order_updated'];
      const CUSTOMER_EVENTS = ['order_created', 'status_change', 'order_cancelled', 'payment_status', 'delivery_updated'];
      
      const target = {
        isToAdmin: EXEC_EVENTS.includes(type) || MONITOR_EVENTS.includes(type),
        isToCustomer: CUSTOMER_EVENTS.includes(type),
        isBroadcast: type === 'broadcast'
      };

      // 3. Skip if no valid target to avoid record pollution
      if (!target.isToAdmin && !target.isToCustomer && !target.isBroadcast) {
        return; 
      }

      // 4. Persistence: NotificationLog is now the Single Source of Truth (Directive #2)
      // We will create the log record first.
      const content = payload?.notificationContent || notificationService._generateStatusContent(orderContext || {}, type);
      
      const logRecord = await container.prisma.notificationLog.create({
        data: {
          userId: orderContext?.customer?.uuid || 'system',
          customerId: orderContext?.customerId || null,
          orderId: orderContext?.id || null,
          type: type,
          title: content.title,
          body: content.message,
          status: 'PENDING'
        }
      });

      try {
        // 5. 🚀 Synchronous Delivery (Blocking until attempt finishes)
        // This ensures Redis XACK only happens after this block succeeds.
        
        let deliveryResult = null;
        if (target.isBroadcast) {
          deliveryResult = await firebaseService.sendBroadcast(content.title, content.message, { type: 'broadcast', logId: String(logRecord.id) });
        } else if (target.isToAdmin) {
          deliveryResult = await firebaseService.sendToTopic('staff_orders', content.title, content.message, { type: 'order_created', logId: String(logRecord.id) });
        } else if (target.isToCustomer && orderContext?.customer?.fcmToken) {
          deliveryResult = await firebaseService.sendToToken(orderContext.customer.fcmToken, content.title, content.message, { type: type, logId: String(logRecord.id) });
        }

        // 6. Finalize Record Status
        await container.prisma.notificationLog.update({
          where: { id: logRecord.id },
          data: { 
            status: deliveryResult ? 'SENT' : 'FAILED',
            sentAt: deliveryResult ? new Date() : null
          }
        });

        logger.info(`[NotificationEngine] ✅ Delivery attempt complete for ${type} (Log: ${logRecord.id})`);
      } catch (err) {
        // 🚨 CRITICAL: If delivery fails with a retriable error, we THROW.
        // This prevents the XACK and lets the Stream Backbone/PEL retry the event later.
        
        await container.prisma.notificationLog.update({
          where: { id: logRecord.id },
          data: { status: 'FAILED', error: err.message }
        }).catch(() => {});

        logger.error(`[NotificationEngine] ❌ Delivery failure for ${type}. Deferring XACK for retry.`, { error: err.message });
        throw err; // Signal to StreamConsumerGroup to NOT acknowledge
      }
    }
  }
);

module.exports = notificationEngineConsumer;
