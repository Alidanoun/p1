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

  // --- Order Modifications ---
  MODIFICATION_REQUESTED: 'order.modification.requested',
  MODIFICATION_APPLIED: 'order.modification.applied',
  MODIFICATION_REJECTED: 'order.modification.rejected',

  // --- Wallet & Financial ---
  WALLET_CREDITED: 'wallet.credited',
  WALLET_DEBITED: 'wallet.debited',
  
  // --- Inventory & Items ---
  ITEM_STOCK_UPDATED: 'item.stock.updated',
  ITEM_PRICE_CHANGED: 'item.price.changed',

  // --- System ---
  SYSTEM_ALERT: 'system.alert'
};
