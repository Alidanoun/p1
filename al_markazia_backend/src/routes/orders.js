const express = require('express');
const { orderLimiter } = require('../middleware/rateLimiter');
const { checkPermission } = require('../middleware/permissionMiddleware');

const { 
  authenticateToken: authMiddleware, 
  isAdmin: adminMiddleware,
  isManager: managerMiddleware,
  hasPermission,
  authenticateCustomer
} = require('../middleware/auth');
const { PERMISSIONS } = require('../config/permissions');
const BranchAccessMiddleware = require('../middleware/branchAccessMiddleware');
const validateOrderBranch = require('../middleware/validateOrderBranch');
const enforceIntent = require('../middleware/enforceIntent');
const { healthGuard } = require('../middleware/healthGuard');
const workingHoursGuard = require('../middleware/workingHoursGuard');
const { verifyOrderOwnership } = require('../middleware/ownership');
const { validateId } = require('../utils/security');

const priceValidation = require('../middleware/priceValidation');
const { 
  createOrder, 
  getOrders,
  getOrdersReport,
  getOrderById,
  getMyOrders,
  syncOrders,
  updateOrderStatus, 
  acceptAllNewOrders,
  updateOrderTimer, 
  submitOrderRating, 
  cancelOrder, 
  approveCancellation,
  rejectCancellation,
  handleCancellationRequest,
  forceCancelOrder,
  requestPartialCancel,
  handlePartialCancelRequest,
  getPendingPartialCancels,
  updatePreparationTime,
  suggestReplacement,
  respondReplacement,
  requestCoupon,
  archiveCompletedOrders
} = require('../controllers/orderController');

const {
  validatePartialCancelRequest,
  validateHandlePartialCancel,
  validateOrderCreate,
  validateOrderRating
} = require('../middleware/orderValidation');

const idempotency = require('../services/idempotencyService');

const router = express.Router();

// Require authentication for order creation — guests can only browse the menu
// Idempotency-Key header (UUID) is mandatory — prevents duplicate orders on network retry
router.post('/', authMiddleware, idempotency.guard(true), validateOrderBranch, healthGuard('db'), workingHoursGuard, priceValidation, validateOrderCreate, orderLimiter, createOrder);

// New Secure Identity Route: Get orders for the authenticated customer
router.get('/my-orders', authMiddleware, getMyOrders);

// Customer-specific endpoint for fetching own order details securely (prevents 403)
router.get('/customer/orders/:id', authenticateCustomer, verifyOrderOwnership, validateId(), getOrderById);

// Report endpoint with date filtering (no row limit)
router.get('/report', authMiddleware, adminMiddleware, BranchAccessMiddleware, enforceIntent('read'), getOrdersReport);

// Only admin/manager can view and update (RBAC v3)
router.get('/', authMiddleware, checkPermission('liveOrders', 'VIEW'), hasPermission(PERMISSIONS.ORDER_VIEW), BranchAccessMiddleware, enforceIntent('read'), getOrders);
router.get('/sync', authMiddleware, checkPermission('liveOrders', 'VIEW'), hasPermission(PERMISSIONS.ORDER_VIEW), BranchAccessMiddleware, enforceIntent('read'), syncOrders);
router.get('/:id', authMiddleware, checkPermission('liveOrders', 'VIEW'), hasPermission(PERMISSIONS.ORDER_VIEW), BranchAccessMiddleware, enforceIntent('read'), validateId(), getOrderById);
router.post('/accept-all', authMiddleware, checkPermission('manageOrders', 'FULL'), hasPermission(PERMISSIONS.ORDER_UPDATE_STATUS), BranchAccessMiddleware, enforceIntent('write'), idempotency.guard(true), acceptAllNewOrders);
router.patch('/:id/status', authMiddleware, checkPermission('manageOrders', 'FULL'), hasPermission(PERMISSIONS.ORDER_UPDATE_STATUS), BranchAccessMiddleware, verifyOrderOwnership, enforceIntent('write'), healthGuard('db'), idempotency.guard(true), validateId(), updateOrderStatus);
router.patch('/:id/timer', authMiddleware, checkPermission('manageOrders', 'EDIT_PIN'), hasPermission(PERMISSIONS.ORDER_MANAGE_TIMER), BranchAccessMiddleware, verifyOrderOwnership, enforceIntent('write'), idempotency.guard(true), validateId(), updateOrderTimer);
router.patch('/:id/prep-time', authMiddleware, checkPermission('manageOrders', 'EDIT_PIN'), hasPermission(PERMISSIONS.ORDER_MANAGE_TIMER), BranchAccessMiddleware, verifyOrderOwnership, enforceIntent('write'), idempotency.guard(true), validateId(), updatePreparationTime);
router.patch('/:id/rate', authMiddleware, verifyOrderOwnership, enforceIntent('write'), idempotency.guard(true), validateId(), validateOrderRating, submitOrderRating);

// Cancel order (Unified logic for Customer and Admin)
router.post('/:id/cancel', authMiddleware, BranchAccessMiddleware, verifyOrderOwnership, enforceIntent('write'), idempotency.guard(true), cancelOrder);
router.post('/:id/approve-cancel', authMiddleware, checkPermission('manageOrders', 'EDIT_PIN'), hasPermission(PERMISSIONS.ORDER_CANCEL), BranchAccessMiddleware, verifyOrderOwnership, enforceIntent('write'), idempotency.guard(true), approveCancellation);
router.post('/:id/reject-cancel', authMiddleware, checkPermission('manageOrders', 'EDIT_PIN'), hasPermission(PERMISSIONS.ORDER_CANCEL), BranchAccessMiddleware, verifyOrderOwnership, enforceIntent('write'), idempotency.guard(true), rejectCancellation);

router.post('/:id/handle-cancellation', authMiddleware, checkPermission('manageOrders', 'EDIT_PIN'), hasPermission(PERMISSIONS.ORDER_CANCEL), BranchAccessMiddleware, verifyOrderOwnership, enforceIntent('write'), idempotency.guard(true), validateId(), handleCancellationRequest);
router.post('/admin/:id/force-cancel', authMiddleware, adminMiddleware, checkPermission('manageOrders', 'EDIT_PIN'), hasPermission(PERMISSIONS.ORDER_CANCEL), BranchAccessMiddleware, enforceIntent('write'), idempotency.guard(true), validateId(), forceCancelOrder);

// --- Partial Cancellation ---

// Request from Customer
router.post(
  "/:orderId/partial-cancel",
  authMiddleware,
  BranchAccessMiddleware,
  enforceIntent('write'),
  idempotency.guard(true),
  validateId('orderId'),
  validatePartialCancelRequest,
  requestPartialCancel
);

// Decision from Admin
router.post(
  "/:orderId/handle-partial-cancel",
  authMiddleware,
  checkPermission('manageOrders', 'EDIT_PIN'),
  hasPermission(PERMISSIONS.ORDER_PARTIAL_CANCEL),
  BranchAccessMiddleware,
  enforceIntent('write'),
  idempotency.guard(true),
  validateId('orderId'),
  validateHandlePartialCancel,
  handlePartialCancelRequest
);


// Admin List Review
router.get(
  "/pending-partial-cancels",
  authMiddleware,
  managerMiddleware,
  BranchAccessMiddleware,
  getPendingPartialCancels
);

// --- Item Replacement & Coupon Compensation ---
// Branch suggests a replacement for an unavailable item
router.post(
  "/:id/items/:itemId/suggest-replacement",
  authMiddleware,
  checkPermission('manageOrders', 'EDIT_PIN'),
  hasPermission(PERMISSIONS.ORDER_UPDATE_STATUS),
  BranchAccessMiddleware,
  verifyOrderOwnership,
  enforceIntent('write'),
  idempotency.guard(true),
  validateId('id'),
  validateId('itemId'),
  suggestReplacement
);

// Customer (or system) responds to the replacement suggestion
router.post(
  "/:id/items/:itemId/respond-replacement",
  authMiddleware,
  verifyOrderOwnership,
  enforceIntent('write'),
  idempotency.guard(true),
  validateId('id'),
  validateId('itemId'),
  respondReplacement
);

// Customer requests a coupon for a cancelled item
router.post(
  "/:id/items/:itemId/request-coupon",
  authMiddleware,
  verifyOrderOwnership,
  enforceIntent('write'),
  idempotency.guard(true),
  validateId('id'),
  validateId('itemId'),
  requestCoupon
);

// Manual end-of-day archiving route for Admins/Managers
router.post(
  "/archive-completed",
  authMiddleware,
  managerMiddleware,
  BranchAccessMiddleware,
  enforceIntent('write'),
  idempotency.guard(true),
  archiveCompletedOrders
);

module.exports = router;
