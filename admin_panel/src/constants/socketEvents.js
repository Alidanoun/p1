/**
 * 📡 Unified Realtime Contract — Single Source of Truth
 * MANDATORY: All layers (Backend, Frontend, Services) must use this file.
 */

export const SOCKET_EVENTS = {
  // --- 🛠️ EXECUTION LAYER (For Branches) ---
  EXEC_ORDER_CREATED: 'exec:order:created',
  EXEC_ORDER_UPDATED: 'exec:order:updated',
  EXEC_ORDER_CANCELLED: 'exec:order:cancelled',

  // --- 👁️ MONITORING LAYER (For Admins) ---
  MONITOR_ORDER_CREATED: 'monitor:order:created',
  MONITOR_ORDER_UPDATED: 'monitor:order:updated',
  MONITOR_ORDER_CANCELLED: 'monitor:order:cancelled',
  
  // --- 👤 CUSTOMER LAYER ---
  CUSTOMER_ORDER_UPDATED: 'customer:order:updated',
  
  // --- SHARED DATA ---
  DASHBOARD_METRICS_UPDATE: 'dashboard:metrics:update',
  NOTIFICATION_NEW: 'notification:new',
  SYSTEM_ALERT: 'system:alert',
  DRIVER_LOCATION_UPDATE: 'tracking:location_update',
  
  // --- LEGACY / CUSTOM ---
  ORDER_CANCELLATION_REQUESTED: 'order:cancellation_requested'
};

export const SOCKET_ROOMS = {
  EXEC_BRANCH: (id) => `room:exec:branch:${id}`,
  MONITOR_GLOBAL: 'room:monitor:global',
  MONITOR_BRANCH: (id) => `room:monitor:branch:${id}`,
  CUSTOMER: (id) => `room:user:${id}`,
  ORDER_TRACKING: (id) => `room:tracking:order:${id}`,
};
