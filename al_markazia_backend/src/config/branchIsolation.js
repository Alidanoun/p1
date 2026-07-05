/**
 * 🏢 Branch Isolation Configuration
 * Centralized list of models requiring strict branch-level logical isolation.
 */
const BRANCH_ISOLATED_MODELS = new Set([
  'Order',
  'BranchItem',
  'BranchPermissions',
  'FinancialLedger',
  'DailyFinancialSnapshot',
  'SystemAuditLog',
  'FinancialApproval',
  'BranchMetric',
  'DeliveryZone',
  'CustomerAuditLog',
  'OrderAuditLog',
  'BranchVariant',
  'OrderCancellation',
  'OrderAuditLogArchive',
  'OrderModificationEvent',
  'OpportunityAuditLog'
]);

module.exports = {
  BRANCH_ISOLATED_MODELS
};
