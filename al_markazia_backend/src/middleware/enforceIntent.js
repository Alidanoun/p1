const logger = require('../utils/logger');
const response = require('../utils/response');

/**
 * 🛡️ Intent Enforcement Middleware (Security Layer)
 * Ensures that users in "Monitoring" roles cannot perform write operations.
 * 
 * Intent Types:
 * - 'read': Viewing, listing, exporting data (allowed for all authorized users)
 * - 'write': Creating, updating, deleting, modifying data (restricted to execution roles)
 * 
 * Usage:
 *   router.put('/orders/:id/status', enforceIntent('write'), updateOrderStatus);
 *   router.get('/orders', enforceIntent('read'), listOrders);
 */

// 🔒 Operation-to-Intent mapping for auditing and auto-detection
const OPERATION_INTENTS = {
  // Read operations
  'getOrder': 'read',
  'listOrders': 'read',
  'getOrderHistory': 'read',
  'exportOrders': 'read',
  'getMetrics': 'read',
  'getDashboard': 'read',
  
  // Write operations
  'createOrder': 'write',
  'updateOrder': 'write',
  'updateStatus': 'write',
  'cancelOrder': 'write',
  'assignOrder': 'write',
  'approveModification': 'write',
  'rejectModification': 'write'
};

/**
 * Determine the maximum intent level allowed for a user based on their role
 * and branch assignment context.
 * 
 * @param {Object} user - The authenticated user object
 * @returns {'read' | 'write'} The maximum allowed intent
 */
function getUserMaxIntent(user) {
  if (!user) return 'read'; // No auth = read-only at most
  
  const role = user.role?.toLowerCase();
  
  // Super Admin: Full write access everywhere
  if (role === 'admin') return 'write';
  
  // Admin (non-super): Read-only monitoring by default
  // They can observe all branches but cannot modify orders directly
  if (role === 'admin') return 'read';
  
  // Branch Manager / Manager: Write access to their own branch
  if (['branch_manager', 'manager'].includes(role)) return 'write';
  
  // Customer: Write access for their own operations (ratings, cancellations)
  // Actual ownership verification is enforced by ContractGateway
  if (role === 'customer') return 'write';
  
  return 'read'; // Default: read-only
}

/**
 * Middleware factory: enforces that the user's maximum intent
 * meets or exceeds the required intent for the operation.
 * 
 * @param {'read' | 'write'} requiredIntent - The intent level required by this route
 * @returns {Function} Express middleware
 */
function enforceIntent(requiredIntent) {
  return async (req, res, next) => {
    const user = req.user;
    const userMaxIntent = getUserMaxIntent(user);
    
    if (requiredIntent === 'write' && userMaxIntent === 'read') {
      // 🚨 BLOCKED: User is in read-only mode trying to perform a write operation
      logger.security('WRITE_BLOCKED_BY_INTENT_POLICY', {
        userId: user?.id,
        role: user?.role,
        method: req.method,
        path: req.originalUrl,
        requiredIntent,
        userMaxIntent,
        ip: req.ip
      });

      // Audit log for security monitoring
      try {
        const auditService = require('../services/auditService');
        await auditService.log({
          userId: user?.id,
          userRole: user?.role,
          action: 'MONITORING_WRITE_ATTEMPT_BLOCKED',
          entityType: 'Order',
          status: 'BLOCKED',
          severity: 'WARN',
          metadata: {
            method: req.method,
            path: req.originalUrl,
            targetBranchId: req.body?.branchId || req.params?.branchId
          },
          req
        });
      } catch (auditErr) {
        logger.warn('Failed to write audit log for intent block', { error: auditErr.message });
      }

      return response.error(
        res,
        'دورك الحالي يسمح بالمراقبة فقط ولا يسمح بالتعديل',
        'READ_ONLY_MODE',
        403
      );
    }
    
    // Attach intent metadata for downstream use
    req.userIntent = userMaxIntent;
    next();
  };
}

module.exports = enforceIntent;
module.exports.getUserMaxIntent = getUserMaxIntent;
module.exports.OPERATION_INTENTS = OPERATION_INTENTS;
