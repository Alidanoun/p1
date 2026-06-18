/**
 * 🔒 Order State Machine (Declarative & Versioned)
 * Phase 1: State Discipline
 */
const STATE_MACHINE_VERSION = '1.0';

const transitions = {
  // 🟢 Initial State
  'pending': {
    to: {
      'preparing': {
        permissions: ['admin', 'manager', 'branch_manager', 'cashier', 'supervisor', 'superadmin', 'super_admin'],
        sideEffects: ['update_metrics']
      },
      'cancelled': {
        permissions: ['customer', 'admin', 'manager', 'branch_manager', 'superadmin', 'super_admin'],
        financialPolicy: 'REFUND_IF_WALLET',
        sideEffects: ['release_stock', 'emit_cancelled_event']
      }
    }
  },
  // 🟡 Processing
  'preparing': {
    to: {
      'ready': {
        permissions: ['admin', 'manager', 'branch_manager', 'cashier', 'supervisor', 'superadmin', 'super_admin'],
        sideEffects: ['notify_ready_socket']
      },
      'cancelled': {
        permissions: ['admin', 'manager', 'branch_manager', 'superadmin', 'super_admin'],
        requiresApproval: false,
        financialPolicy: 'MANUAL_REFUND_CHECK'
      }
    }
  },
  // 🟠 Ready for Pickup/Delivery
  'ready': {
    to: {
      'delivered': {
        permissions: ['admin', 'manager', 'branch_manager', 'driver', 'cashier', 'supervisor', 'superadmin', 'super_admin'],
        sideEffects: ['capture_revenue', 'award_loyalty_points']
      },
      'cancelled': {
        permissions: ['admin', 'manager', 'branch_manager', 'superadmin', 'super_admin'],
        requiresApproval: false
      }
    }
  },
  // 🔴 Terminal State
  'delivered': {
    to: {} // No transitions allowed from terminal state
  },
  'cancelled': {
    to: {} // No transitions allowed from terminal state
  }
};

class OrderStateMachine {
  constructor(logger) {
    this.logger = logger;
    this.version = STATE_MACHINE_VERSION;
  }

  /**
   * Validates if a transition is legal and authorized.
   */
  validate(currentStatus, targetStatus, actor, orderContext = {}) {
    this.logger.debug(`[StateMachine] Validating ${currentStatus} -> ${targetStatus} for ${actor?.role}`);

    const stateConfig = transitions[currentStatus];
    if (!stateConfig) {
      throw new Error(`INVALID_STATE: Current state "${currentStatus}" is not recognized.`);
    }

    const transition = stateConfig.to[targetStatus];
    if (!transition) {
      throw new Error(`ILLEGAL_TRANSITION: Cannot move from "${currentStatus}" to "${targetStatus}".`);
    }

    // Check Permissions
    const actorRole = (actor?.role || 'guest').toLowerCase();
    // Allow super_admin by default, and common branch roles
    const allowedRoles = [...transition.permissions, 'super_admin', 'superadmin', 'cashier', 'supervisor'];
    if (!allowedRoles.includes(actorRole)) {
      throw new Error(`FORBIDDEN_TRANSITION: Role "${actorRole}" is not authorized for this transition.`);
    }

    // Future: Check versioning compatibility if needed
    // if (orderContext.smVersion && orderContext.smVersion !== this.version) { ... }

    return transition;
  }

  /**
   * Returns metadata for the transition (side effects, policies).
   */
  getTransitionMetadata(currentStatus, targetStatus) {
    return transitions[currentStatus]?.to[targetStatus] || null;
  }
}

module.exports = {
  OrderStateMachine,
  STATE_MACHINE_VERSION
};
