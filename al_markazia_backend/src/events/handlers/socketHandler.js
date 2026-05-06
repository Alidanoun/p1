const eventBus = require('../eventBus');
const eventTypes = require('../eventTypes');
const { SOCKET_EVENTS, SOCKET_ROOMS } = require('../../shared/socketEvents');
const logger = require('../../utils/logger');
const analyticsProjection = require('../../projections/analyticsProjection');

/**
 * 📡 Socket Event Handler (UI Synchronization Only)
 */

function getIO() {
  try {
    return require('../../socket').getIO();
  } catch (err) {
    return null;
  }
}

const emitBranchMetrics = (event, context) => {
  const io = getIO();
  if (!io) return;

  const order = event.payload?.order || event.payload;
  if (!order || !order.branchId) return;

  const branchId = order.branchId;
  const branchMetrics = analyticsProjection.getMetrics(branchId);
  
  // 🏢 Broadcast to the specific branch room
  io.to(SOCKET_ROOMS.MONITOR_BRANCH(branchId)).emit(SOCKET_EVENTS.DASHBOARD_METRICS_UPDATE, branchMetrics);
  
  // 🌍 Also broadcast global metrics to the global monitor room
  const globalMetrics = analyticsProjection.getMetrics(null);
  io.to(SOCKET_ROOMS.MONITOR_GLOBAL).emit(SOCKET_EVENTS.DASHBOARD_METRICS_UPDATE, globalMetrics);
  
  logger.debug(`[SocketHandler] Metrics updated for ${context} -> Branch: ${branchId} & Global`);
};

// 1. Order Created (Update Dashboard Metrics)
eventBus.subscribe(eventTypes.ORDER_CREATED, (event) => emitBranchMetrics(event, 'NEW_ORDER'));

// 2. Status Update (Update Dashboard Metrics)
eventBus.subscribe(eventTypes.ORDER_STATUS_CHANGED, (event) => emitBranchMetrics(event, 'STATUS_CHANGE'));

// 3. Cancellation (Update Dashboard Metrics)
eventBus.subscribe(eventTypes.ORDER_CANCELLED, (event) => emitBranchMetrics(event, 'CANCELLATION'));

logger.info('[EventHandlers] Socket UI Handlers Initialized (Branch-Isolated)');

