const logger = require('./logger');

/**
 * 🔒 Financial Permission Guard
 * Prevents unauthorized roles from performing sensitive operations.
 */
class FinancialGuard {
  constructor() {
    this.PERMISSIONS = {
      MODIFY_CONFIRMED_ORDER: ['admin', 'manager'],
      ISSUE_REFUND: ['admin'],
      CANCEL_ORDER: ['admin', 'manager'],
      OVERRIDE_PRICE: ['admin'],
      VIEW_LEDGER: ['admin', 'manager']
    };
    
    // Operations that REQUIRE a second approval if performed by a Manager
    this.NEEDS_SECOND_APPROVAL = {
      MODIFY_CONFIRMED_ORDER: ['manager'],
      ISSUE_REFUND: ['manager', 'admin'] // Even admin might want a second eye for large refunds?
    };
  }

  /**
   * Asserts that a user has permission for an action.
   * Throws Error if unauthorized.
   */
  assertPermission(user, action) {
    if (!user || !user.role) {
      throw new Error('UNAUTHENTICATED_FINANCIAL_ACTION');
    }

    const allowedRoles = this.PERMISSIONS[action];
    if (!allowedRoles) {
      throw new Error(`UNKNOWN_FINANCIAL_ACTION: ${action}`);
    }

    if (!allowedRoles.includes(user.role)) {
      logger.security('🚨 UNAUTHORIZED_FINANCIAL_ATTEMPT', {
        userId: user.id,
        role: user.role,
        action
      });
      throw new Error(`UNAUTHORIZED: Role '${user.role}' cannot perform '${action}'`);
    }

    return true;
  }

  /**
   * Checks if an action requires a two-step approval for this user.
   */
  requiresApproval(user, action) {
    const rolesNeedingApproval = this.NEEDS_SECOND_APPROVAL[action];
    return rolesNeedingApproval && rolesNeedingApproval.includes(user.role);
  }
}

module.exports = new FinancialGuard();
