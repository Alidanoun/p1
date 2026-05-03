/**
 * 📡 Unified Realtime Contract — Single Source of Truth
 * MANDATORY: All layers (Backend, Frontend, Services) must use this file.
 * No strings allowed in logic.
 */

const SOCKET_EVENTS = {
  // --- Order Lifecycle (Contracted) ---
  ORDER_CREATED: 'order:created',
  ORDER_UPDATED: 'order:updated',
  ORDER_CANCELLED: 'order:cancelled',

  // --- Dashboard Analytics (Contracted) ---
  DASHBOARD_METRICS_UPDATE: 'dashboard:metrics:update',

  // --- Notifications & Alerts ---
  NOTIFICATION_NEW: 'notification:new',
  SYSTEM_ALERT: 'system:alert',
  // --- Real-time Tracking ---
  DRIVER_LOCATION_UPDATE: 'tracking:location_update',
};

const SOCKET_ROOMS = {
  ADMIN: 'room:admin',
  DASHBOARD: 'room:dashboard',
  BRANCH_ADMIN: (id) => `room:admin:branch:${id}`,
  // Helper to generate dynamic rooms
  CUSTOMER: (id) => `room:customer:${id}`,
  ORDER_TRACKING: (id) => `room:tracking:order:${id}`,
};

const ROLES = {
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
  CUSTOMER: 'customer',
};

module.exports = { SOCKET_EVENTS, SOCKET_ROOMS, ROLES };
