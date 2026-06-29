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
      const EXEC_EVENTS = [
        'order.created', 'order_created', 
        'order.cancelled', 'order_cancelled', 
        'order.status.changed', 'status_change', 'order_updated', 
        'order_assigned'
      ];
      const MONITOR_EVENTS = [
        'order.created', 'order_created', 
        'order.cancelled', 'order_cancelled', 
        'order.status.changed', 'status_change', 'order_updated'
      ];
      const CUSTOMER_EVENTS = [
        'order.created', 'order_created', 
        'order.status.changed', 'status_change', 
        'order.cancelled', 'order_cancelled', 
        'payment_status', 'delivery_updated'
      ];
      
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
      
      const promises = [];
      const logRecords = [];

      try {
        if (target.isBroadcast) {
          const logRecord = await container.prisma.notificationLog.create({
            data: {
              userId: 'all',
              type: type,
              title: content.title,
              body: content.message,
              status: 'PENDING'
            }
          });
          promises.push(
            firebaseService.sendBroadcast(content.title, content.message, { type: 'broadcast', logId: String(logRecord.id) })
          );
          logRecords.push({ record: logRecord, target: 'broadcast' });
        } else {
          if (target.isToAdmin) {
            const logRecord = await container.prisma.notificationLog.create({
              data: {
                userId: 'admin',
                customerId: orderContext?.customerId || null,
                orderId: orderContext?.id || null,
                type: type,
                title: content.title,
                body: content.message,
                status: 'PENDING'
              }
            });
            promises.push(
              firebaseService.sendToTopic('staff_orders', content.title, content.message, { type: 'order_created', logId: String(logRecord.id) })
            );
            logRecords.push({ record: logRecord, target: 'admin' });
          }
          if (target.isToCustomer && orderContext?.customer?.fcmToken) {
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
            promises.push(
              firebaseService.sendToToken(orderContext.customer.fcmToken, content.title, content.message, { type: type, logId: String(logRecord.id) })
            );
            logRecords.push({ record: logRecord, target: 'customer' });
          }
        }

        if (promises.length === 0) return;

        // 5. 🚀 Parallel Delivery (Blocking until all attempts finish)
        const results = await Promise.allSettled(promises);
        
        let hasError = false;
        const errorMsgs = [];

        // 6. Finalize each log record status individually
        for (let i = 0; i < results.length; i++) {
          const res = results[i];
          const log = logRecords[i];
          const isSuccess = res.status === 'fulfilled' && res.value !== null;
          
          await container.prisma.notificationLog.update({
            where: { id: log.record.id },
            data: {
              status: isSuccess ? 'SENT' : 'FAILED',
              sentAt: isSuccess ? new Date() : null,
              error: res.status === 'rejected' ? (res.reason?.message || String(res.reason)) : (res.value === null ? 'Delivery returned null' : null)
            }
          });

          if (!isSuccess) {
            hasError = true;
            errorMsgs.push(`${log.target}: ${res.status === 'rejected' ? (res.reason?.message || String(res.reason)) : 'delivery failed'}`);
          }
        }

        if (hasError) {
          throw new Error(`Notification delivery failed: ${errorMsgs.join(', ')}`);
        }

        logger.info(`[NotificationEngine] ✅ Delivery attempts complete for ${type}`);
      } catch (err) {
        logger.error(`[NotificationEngine] ❌ Delivery failure for ${type}. Deferring XACK for retry.`, { error: err.message });
        throw err; // Signal to StreamConsumerGroup to NOT acknowledge
      }
    }
  }
);

module.exports = notificationEngineConsumer;
