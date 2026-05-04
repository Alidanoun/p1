/**
 * 📡 Unified Realtime Contract — Single Source of Truth
 * MANDATORY: All layers (Backend, Frontend, Services) must use this file.
 * No strings allowed in logic.
 */

const SOCKET_EVENTS = {
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
};

const SOCKET_ROOMS = {
  // 🛠️ Execution Contexts
  EXEC_BRANCH: (id) => `room:exec:branch:${id}`,
  
  // 👁️ Monitoring Contexts
  MONITOR_GLOBAL: 'room:monitor:global',
  MONITOR_BRANCH: (id) => `room:monitor:branch:${id}`,

  // 👤 User Contexts
  CUSTOMER: (id) => `room:user:${id}`,
  ORDER_TRACKING: (id) => `room:tracking:order:${id}`,
};

const ROLES = {
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
  CUSTOMER: 'customer',
};

module.exports = { SOCKET_EVENTS, SOCKET_ROOMS, ROLES };
