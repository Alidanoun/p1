const eventBus = require('../events/eventBus');
const eventTypes = require('../events/eventTypes');
const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');

/**
 * 🔔 Notification Subscriber
 * Listens to System Events and triggers appropriate notifications.
 */

// 1. Listen for Modification Requests
eventBus.subscribe(eventTypes.MODIFICATION_REQUESTED, async (event) => {
  try {
    const { orderId } = event.payload.event;
    await notificationService.sendToCustomer(null, {
      title: 'تحديث مطلوب على طلبك',
      message: 'لقد اقترح المطعم تعديلاً على طلبك، يرجى المراجعة والموافقة.',
      type: 'ORDER_MODIFICATION_PENDING',
      orderId
    });
  } catch (err) {
    logger.error('[Subscriber] Modification request notification failed', { error: err.message });
  }
});

// 2. Listen for Modification Applied
eventBus.subscribe(eventTypes.MODIFICATION_APPLIED, async (event) => {
  try {
    const { order } = event.payload;
    await notificationService.sendToCustomer(order.customerPhone, {
      title: 'تم تعديل طلبك بنجاح',
      message: `تم تحديث طلبك رقم #${order.orderNumber}. شكراً لتفهمك.`,
      type: 'ORDER_MODIFICATION_APPLIED',
      orderId: order.id
    });
  } catch (err) {
    logger.error('[Subscriber] Modification completion notification failed', { error: err.message });
  }
});

// 3. Listen for Wallet Credits
eventBus.subscribe(eventTypes.WALLET_CREDITED, async (event) => {
  try {
    const { customerId, amount, reason } = event.payload;
    // Notify customer about refund if it's significant
    if (reason && reason.includes('استرداد')) {
      await notificationService.sendToCustomer(null, {
        title: 'تم استرداد مبلغ لمحفظتك 💰',
        message: `تمت إضافة ${amount} د.أ إلى محفظتك. السبب: ${reason}`,
        type: 'WALLET_REFUND',
        customerId
      });
    }
  } catch (err) {
    logger.error('[Subscriber] Wallet notification failed', { error: err.message });
  }
});

// 4. Listen for Order Cancellations
eventBus.subscribe(eventTypes.ORDER_CANCELLED, async (event) => {
  try {
    const { order } = event.payload;
    await notificationService.sendToCustomer(order.customerPhone, {
      title: 'تم إلغاء طلبك 🚫',
      message: `نعتذر، تم إلغاء طلبك رقم #${order.orderNumber}. إذا تم الدفع، ستجد المبلغ في محفظتك.`,
      type: 'ORDER_CANCELLED',
      orderId: order.id
    });
  } catch (err) {
    logger.error('[Subscriber] Cancellation notification failed', { error: err.message });
  }
});

// 5. Listen for Cancellation Requests (Admin Alert)
eventBus.subscribe(eventTypes.ORDER_CANCELLATION_REQUESTED, async (event) => {
  try {
    const { order } = event.payload;
    logger.info(`[Subscriber] Alert: Customer requested cancellation for #${order.orderNumber}`);
    // Admin notifications are usually handled via separate admin-socket or dashboard events
  } catch (err) {
    logger.error('[Subscriber] Cancellation request log failed', { error: err.message });
  }
});

logger.info('🚀 Notification Subscriber initialized and listening to EventBus');
