const logger = require('../utils/logger');

/**
 * ⚖️ Order Modification Policy Engine
 * The "Brain" that decides if a modification is allowed and under what conditions.
 */
class OrderModificationPolicyEngine {

  /**
   * 🧠 Evaluate Request
   * Returns a decision object: { allowed: bool, needsApproval: bool, reason: string, fee: number }
   */
  evaluate(order, modificationRequest, user) {
    const { type, modifications } = modificationRequest;
    const orderStatus = order.status;

    // 1. Status Guard (Global)
    if (['delivered', 'cancelled'].includes(orderStatus)) {
      return { allowed: false, reason: 'ORDER_IS_FINALIZED' };
    }

    // 2. Evaluate based on type
    switch (type) {
      case 'CANCEL_ORDER':
        return this._evaluateCancellation(order, user);
      
      case 'REPLACE_ITEM':
        return this._evaluateReplacement(order, modifications, user);
      
      case 'PARTIAL_CANCEL':
        return this._evaluatePartialCancel(order, modifications, user);
      
      default:
        return { allowed: false, reason: 'UNKNOWN_MODIFICATION_TYPE' };
    }
  }

  // --- Private Policy Rules ---

  _evaluateCancellation(order, user) {
    // If order is "Ready" or "In Route", only Manager can cancel
    if (['ready', 'in_route'].includes(order.status) && user.role !== 'admin' && user.role !== 'super_admin') {
      return { allowed: false, needsApproval: true, reason: 'MANAGER_APPROVAL_REQUIRED_FOR_ADVANCED_STAGE' };
    }
    
    return { allowed: true, needsApproval: false, fee: this._calculateCancellationFee(order) };
  }

  _evaluateReplacement(order, modifications, user) {
    // Replacement is only allowed before "Ready" stage for normal staff
    if (['preparing', 'ready'].includes(order.status) && user.role === 'staff') {
      return { allowed: false, reason: 'STAFF_CANNOT_REPLACE_DURING_PREPARATION' };
    }

    // If new price is higher by more than 20%, need Customer Approval
    // (This would be calculated after Pricing Engine preview)
    
    return { allowed: true, needsApproval: false };
  }

  _evaluatePartialCancel(order, modifications, user) {
    if (order.orderItems.length <= 1) {
      return { allowed: false, reason: 'CANNOT_PARTIAL_CANCEL_LAST_ITEM' };
    }
    return { allowed: true, needsApproval: false };
  }

  _calculateCancellationFee(order) {
    // Business logic for fees based on timing/status
    if (order.status === 'preparing') return 1.5; // Fixed fee for demo
    if (order.status === 'ready') return 3.0;
    return 0;
  }
}

module.exports = new OrderModificationPolicyEngine();
