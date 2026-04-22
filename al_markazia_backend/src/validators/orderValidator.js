/**
 * Order Validator - The Single Source of Truth for Status Transitions.
 * Defines the strict State Machine for the Al-Markazia Ordering System.
 */

const ORDER_STATUS_MAP = {
  'pending': ['confirmed', 'preparing', 'cancelled', 'waiting_cancellation'],
  'confirmed': ['preparing', 'cancelled', 'waiting_cancellation'],
  'preparing': ['ready', 'cancelled', 'waiting_cancellation'],
  'ready': ['delivered', 'cancelled'],
  'in_route': ['delivered', 'cancelled'],
  'waiting_cancellation': ['cancelled', 'preparing', 'ready', 'confirmed'],
  'delivered': [], // Final State
  'cancelled': []  // Final State
};

/**
 * Validates if an order can move from its current status to a new status.
 * @param {string} from - Current Status
 * @param {string} to - Target Status
 * @returns {boolean}
 */
const canTransition = (from, to) => {
  if (!from) return true; // Initial creation
  if (from === to) return true; // No change
  
  return ORDER_STATUS_MAP[from]?.includes(to) || false;
};

module.exports = {
  ORDER_STATUS_MAP,
  canTransition
};
