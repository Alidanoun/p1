/**
 * 🏷️ Event Types Definition
 * Standardized constants for all system events.
 */

module.exports = {
  // --- Order Lifecycle ---
  ORDER_CREATED: 'order.created',
  ORDER_STATUS_CHANGED: 'order.status.changed',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_CANCELLATION_REQUESTED: 'order.cancellation.requested',
  
  // --- Inventory & Items ---
  ITEM_STOCK_UPDATED: 'item.stock.updated',
  ITEM_PRICE_CHANGED: 'item.price.changed',
  
  // --- System ---
  SYSTEM_ALERT: 'system.alert'
};
