const express = require('express');
const { orderLimiter, guestOrderLimiter } = require('../middleware/rateLimiter');

const { 
  authenticateToken: authMiddleware, 
  isAdmin: adminMiddleware,
  isManager: managerMiddleware,
  hasPermission,
  optionalAuth
} = require('../middleware/auth');
const { PERMISSIONS } = require('../config/permissions');
const { requireBranchAccess, ensureBranchId } = require('../middleware/branchAuth');
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
  getMyOrders,
  syncOrders,
  updateOrderStatus, 
  acceptAllNewOrders,
  getCustomerOrders, 
  updateOrderTimer, 
  submitOrderRating, 
  cancelOrder, 
  approveCancellation,
  rejectCancellation,
  handleCancellationRequest,
  requestPartialCancel,
  handlePartialCancelRequest,
  getPendingPartialCancels,
  updatePreparationTime
} = require('../controllers/orderController');

const {
  validatePartialCancelRequest,
  validateHandlePartialCancel,
  validateCancelOrder,
  validateOrderCreate,
  validateOrderRating
} = require('../middleware/orderValidation');

const idempotency = require('../services/idempotencyService');

const router = express.Router();

// Allow guests (app) to create orders while identifying registered customers
// 🛡️ Gateway handles idempotency + system mode + circuit breaker
router.post('/', guestOrderLimiter, optionalAuth, validateOrderBranch, healthGuard('db'), workingHoursGuard, orderLimiter, validateOrderCreate, priceValidation, createOrder);

// New Secure Identity Route: Get orders for the authenticated customer
router.get('/my-orders', authMiddleware, getMyOrders);

// Report endpoint with date filtering (no row limit)
router.get('/report', authMiddleware, adminMiddleware, requireBranchAccess, enforceIntent('read'), getOrdersReport);

// Only admin/manager can view and update (RBAC v3)
router.get('/', authMiddleware, hasPermission(PERMISSIONS.ORDER_VIEW), requireBranchAccess, enforceIntent('read'), getOrders);
router.get('/sync', authMiddleware, hasPermission(PERMISSIONS.ORDER_VIEW), requireBranchAccess, enforceIntent('read'), syncOrders);
router.post('/accept-all', authMiddleware, hasPermission(PERMISSIONS.ORDER_UPDATE_STATUS), requireBranchAccess, enforceIntent('write'), idempotency.guard(true), acceptAllNewOrders);
router.patch('/:id/status', authMiddleware, hasPermission(PERMISSIONS.ORDER_UPDATE_STATUS), requireBranchAccess, verifyOrderOwnership, enforceIntent('write'), healthGuard('db'), idempotency.guard(true), validateId(), updateOrderStatus);
router.patch('/:id/timer', authMiddleware, hasPermission(PERMISSIONS.ORDER_MANAGE_TIMER), requireBranchAccess, verifyOrderOwnership, enforceIntent('write'), idempotency.guard(true), validateId(), updateOrderTimer);
router.patch('/:id/prep-time', authMiddleware, hasPermission(PERMISSIONS.ORDER_MANAGE_TIMER), requireBranchAccess, verifyOrderOwnership, enforceIntent('write'), idempotency.guard(true), validateId(), updatePreparationTime);
router.patch('/:id/rate', authMiddleware, verifyOrderOwnership, enforceIntent('write'), idempotency.guard(true), validateId(), validateOrderRating, submitOrderRating);

// Cancel order (Unified logic for Customer and Admin)
router.post('/:id/cancel', authMiddleware, requireBranchAccess, verifyOrderOwnership, enforceIntent('write'), idempotency.guard(true), cancelOrder);
router.post('/:id/approve-cancel', authMiddleware, hasPermission(PERMISSIONS.ORDER_CANCEL), requireBranchAccess, verifyOrderOwnership, enforceIntent('write'), idempotency.guard(true), approveCancellation);
router.post('/:id/reject-cancel', authMiddleware, hasPermission(PERMISSIONS.ORDER_CANCEL), requireBranchAccess, verifyOrderOwnership, enforceIntent('write'), idempotency.guard(true), rejectCancellation);

router.post('/:id/handle-cancellation', authMiddleware, hasPermission(PERMISSIONS.ORDER_CANCEL), requireBranchAccess, verifyOrderOwnership, enforceIntent('write'), idempotency.guard(true), validateId(), handleCancellationRequest);

// --- Partial Cancellation ---

// Request from Customer
router.post(
  "/:orderId/partial-cancel",
  authMiddleware,
  requireBranchAccess,
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
  hasPermission(PERMISSIONS.ORDER_PARTIAL_CANCEL),
  requireBranchAccess,
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
  requireBranchAccess,
  getPendingPartialCancels
);

module.exports = router;
