/**
 * ⚖️ Event Governance (SDS 3.0)
 * Defines Intents, Priorities and Backpressure behaviors.
 */

const INTENTS = {
  GUARANTEED: 'GUARANTEED',     // 🛡️ Security, Financial, Critical Sync (NEVER DROP)
  INVALIDATION: 'INVALIDATION', // 🛰️ State change signals (COALESCE UNDER PRESSURE)
  BEST_EFFORT: 'BEST_EFFORT',   // 📊 Analytics, Metrics, UI Polish (DROP UNDER PRESSURE)
};

const PRIORITIES = {
  CRITICAL: 100, // Auth, Revocation
  HIGH: 80,     // Order Creation, Payments
  MEDIUM: 50,   // Status Updates
  LOW: 20       // Metrics, Non-critical UI
};

const EVENT_GOVERNANCE = {
  // Auth & Security (Priority: CRITICAL, Intent: GUARANTEED)
  'USER_AUTH_CHANGED': { intent: INTENTS.GUARANTEED, priority: PRIORITIES.CRITICAL },
  'SESSION_REVOKED': { intent: INTENTS.GUARANTEED, priority: PRIORITIES.CRITICAL },

  // Orders (Priority: HIGH/MEDIUM, Intent: INVALIDATION)
  'ORDER_CREATED': { intent: INTENTS.GUARANTEED, priority: PRIORITIES.HIGH }, // First notification is guaranteed
  'ORDER_STATUS_CHANGED': { intent: INTENTS.INVALIDATION, priority: PRIORITIES.MEDIUM },
  'MODIFICATION_APPLIED': { intent: INTENTS.INVALIDATION, priority: PRIORITIES.MEDIUM },

  // Financial (Priority: HIGH, Intent: GUARANTEED)
  'PAYMENT_CONFIRMED': { intent: INTENTS.GUARANTEED, priority: PRIORITIES.HIGH },
  'FINANCIAL_APPROVAL_REQUIRED': { intent: INTENTS.GUARANTEED, priority: PRIORITIES.HIGH },

  // Analytics & Polish (Priority: LOW, Intent: BEST_EFFORT)
  'DASHBOARD_METRICS_UPDATE': { intent: INTENTS.BEST_EFFORT, priority: PRIORITIES.LOW },
  'TYPING_INDICATOR': { intent: INTENTS.BEST_EFFORT, priority: PRIORITIES.LOW }
};

/**
 * Helper to get governance for any event
 */
function getGovernance(type) {
  return EVENT_GOVERNANCE[type] || { intent: INTENTS.BEST_EFFORT, priority: PRIORITIES.LOW };
}

module.exports = {
  INTENTS,
  PRIORITIES,
  getGovernance
};
