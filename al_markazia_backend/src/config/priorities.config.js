/**
 * 📢 Notification Priorities & Channel Mapping
 */
const NOTIFICATION_PRIORITIES = {
  CRITICAL: 'critical', // Bypasses Quiet Hours, highest retry rate
  HIGH: 'high',         // Immediate delivery, respects user opt-out
  NORMAL: 'normal',     // Standard delivery, respects Quiet Hours
  LOW: 'low'            // Batchable, lowest priority
};

const EVENT_TYPE_CONFIG = {
  ORDER_STATUS_UPDATE: {
    priority: NOTIFICATION_PRIORITIES.HIGH,
    channels: ['fcm', 'socket'],
    category: 'operational'
  },
  ORDER_NEW: {
    priority: NOTIFICATION_PRIORITIES.CRITICAL,
    channels: ['fcm', 'socket'],
    category: 'admin_ops'
  },
  PAYMENT_SUCCESS: {
    priority: NOTIFICATION_PRIORITIES.HIGH,
    channels: ['fcm', 'socket'],
    category: 'financial'
  },
  PROMOTION: {
    priority: NOTIFICATION_PRIORITIES.NORMAL,
    channels: ['fcm'],
    category: 'marketing'
  },
  SYSTEM_ALERT: {
    priority: NOTIFICATION_PRIORITIES.CRITICAL,
    channels: ['fcm', 'socket'],
    category: 'system'
  }
};

module.exports = {
  NOTIFICATION_PRIORITIES,
  EVENT_TYPE_CONFIG
};
