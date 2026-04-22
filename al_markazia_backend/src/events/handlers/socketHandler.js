const eventBus = require('../eventBus');
const eventTypes = require('../eventTypes');
const { SOCKET_EVENTS, SOCKET_ROOMS } = require('../../shared/socketEvents');
const logger = require('../../utils/logger');
const analyticsProjection = require('../../projections/analyticsProjection');

/**
 * 📡 Socket Event Handler (UI Synchronization Only)
 * 
 * Note: Notification-related socket emits are handled by notificationService.js
 * to ensure guaranteed delivery and state tracking.
 * 
 * This handler focuses on generic UI sync (like Dashboard Metrics).
 */

function getIO() {
  try {
    return require('../../socket').getIO();
  } catch (err) {
    return null;
  }
}

// 1. Order Created (Update Dashboard Metrics)
eventBus.subscribe(eventTypes.ORDER_CREATED, (event) => {
  const io = getIO();
  if (!io) return;

  // 📈 Broadcast updated metrics to Dashboard Room
  io.to(SOCKET_ROOMS.DASHBOARD).emit(SOCKET_EVENTS.DASHBOARD_METRICS_UPDATE, analyticsProjection.getMetrics());
  logger.debug('[SocketHandler] Metrics updated for NEW_ORDER');
});

// 2. Status Update (Update Dashboard Metrics)
eventBus.subscribe(eventTypes.ORDER_STATUS_CHANGED, (event) => {
  const io = getIO();
  if (!io) return;

  // 📈 Broadcast updated metrics to Dashboard Room
  io.to(SOCKET_ROOMS.DASHBOARD).emit(SOCKET_EVENTS.DASHBOARD_METRICS_UPDATE, analyticsProjection.getMetrics());
  logger.debug('[SocketHandler] Metrics updated for STATUS_CHANGE');
});

// 3. Cancellation (Update Dashboard Metrics)
eventBus.subscribe(eventTypes.ORDER_CANCELLED, (event) => {
  const io = getIO();
  if (!io) return;

  // 📈 Broadcast updated metrics to Dashboard Room
  io.to(SOCKET_ROOMS.DASHBOARD).emit(SOCKET_EVENTS.DASHBOARD_METRICS_UPDATE, analyticsProjection.getMetrics());
  logger.debug('[SocketHandler] Metrics updated for CANCELLATION');
});

logger.info('[EventHandlers] Socket UI Handlers Initialized');
