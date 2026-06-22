const eventBus = require('../eventBus');
const eventTypes = require('../eventTypes');
const { SOCKET_EVENTS, SOCKET_ROOMS } = require('../../shared/socketEvents');
const logger = require('../../utils/logger');
const { mapOrderResponse } = require('../../mappers/order.mapper');

/**
 * 🌉 Event to Socket Bridge (SDS 3.0)
 * THE canonical bridge between internal domain events and real-time socket broadcasts.
 * Decouples synchronization logic from NotificationService and side-effects.
 */

function getIO() {
  try {
    return require('../../socket').getIO();
  } catch (err) {
    return null;
  }
}

const handleOrderEvent = async (event) => {
  const io = getIO();
  if (!io) return;

  const { type, payload } = event;
  const order = payload.order || payload;
  
  if (!order || !order.id) return;

  const orderId = order.id;
  const branchId = order.branchId;
  const customerUuid = order.customer?.uuid || order.customerUuid;

  // 🛡️ Map Domain Event → Socket Event
  let socketEvent;
  switch (type) {
    case eventTypes.ORDER_CREATED:
      socketEvent = SOCKET_EVENTS.EXEC_ORDER_CREATED;
      break;
    case eventTypes.ORDER_STATUS_CHANGED:
      socketEvent = SOCKET_EVENTS.EXEC_ORDER_UPDATED;
      break;
    case eventTypes.ORDER_CANCELLED:
    case eventTypes.ORDER_CANCELLED_FINALIZED:
      socketEvent = SOCKET_EVENTS.EXEC_ORDER_CANCELLED;
      break;
    case eventTypes.ORDER_CANCELLATION_REQUESTED:
      socketEvent = 'order:cancellation_requested'; // Legacy support or new constant needed
      break;
    default:
      socketEvent = SOCKET_EVENTS.EXEC_ORDER_UPDATED;
  }

  const finalPayload = {
    ...order,
    _syncMetadata: {
      source: 'domain_event_bridge',
      timestamp: Date.now(),
      eventId: event.metadata?.eventId
    }
  };

  const securityPolicyService = require('../../lib/container').securityPolicyService;
  const wrappedPayload = securityPolicyService.wrapPayload(finalPayload);

  // 1. 🏢 Broadcast to Execution Context (Branch)
  if (branchId) {
    io.to(SOCKET_ROOMS.EXEC_BRANCH(branchId)).emit(socketEvent, wrappedPayload);
    io.to(SOCKET_ROOMS.MONITOR_BRANCH(branchId)).emit(socketEvent, wrappedPayload);
  }

  // 2. 🌍 Broadcast to Monitoring Context (Global Admin)
  io.to(SOCKET_ROOMS.MONITOR_GLOBAL).emit(socketEvent, wrappedPayload);

  // 3. 👤 Direct to Customer Context
  if (customerUuid) {
    io.to(SOCKET_ROOMS.CUSTOMER(customerUuid)).emit(SOCKET_EVENTS.CUSTOMER_ORDER_UPDATED, wrappedPayload);
    // Legacy support for mobile app
    if (type === eventTypes.ORDER_CREATED) {
      io.to(SOCKET_ROOMS.CUSTOMER(customerUuid)).emit('order:created', wrappedPayload);
    } else {
      io.to(SOCKET_ROOMS.CUSTOMER(customerUuid)).emit('order:updated', wrappedPayload);
    }
  }

  // 4. 🔔 Notification Bell Context (UI Alert)
  const notificationPayload = {
    title: type === eventTypes.ORDER_CREATED ? 'طلب جديد 🔔' : 'تحديث طلب',
    message: `الطلب #${order.orderNumber || order.id}`,
    type: type,
    data: finalPayload
  };
  io.to(SOCKET_ROOMS.MONITOR_GLOBAL).emit(SOCKET_EVENTS.NOTIFICATION_NEW, securityPolicyService.wrapPayload(notificationPayload));
  if (branchId) {
    io.to(SOCKET_ROOMS.EXEC_BRANCH(branchId)).emit(SOCKET_EVENTS.NOTIFICATION_NEW, securityPolicyService.wrapPayload(notificationPayload));
    io.to(SOCKET_ROOMS.MONITOR_BRANCH(branchId)).emit(SOCKET_EVENTS.NOTIFICATION_NEW, securityPolicyService.wrapPayload(notificationPayload));
  }


  logger.debug(`[SocketBridge] 🛰️ Dispatched ${socketEvent} for Order #${orderId}`);
};

// 🔗 Bindings
eventBus.subscribe(eventTypes.ORDER_CREATED, handleOrderEvent);
eventBus.subscribe(eventTypes.ORDER_STATUS_CHANGED, handleOrderEvent);
eventBus.subscribe(eventTypes.ORDER_CANCELLED, handleOrderEvent);
eventBus.subscribe(eventTypes.ORDER_CANCELLED_FINALIZED, handleOrderEvent);
eventBus.subscribe(eventTypes.ORDER_CANCELLATION_REQUESTED, (event) => {
  const io = getIO();
  if (!io) return;
  const { order, level } = event.payload;
  const branchId = order.branchId;
  
  const payload = { order, level };
  const wrapped = require('../../lib/container').securityPolicyService.wrapPayload(payload);
  
  if (branchId) io.to(SOCKET_ROOMS.MONITOR_BRANCH(branchId)).emit('order:cancellation_requested', wrapped);
  io.to(SOCKET_ROOMS.MONITOR_GLOBAL).emit('order:cancellation_requested', wrapped);
});

logger.info('[SocketBridge] 🌉 Real-time Synchronization Bridge Active');
