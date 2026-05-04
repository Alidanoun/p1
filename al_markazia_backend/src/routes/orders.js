const express = require('express');
const { orderLimiter } = require('../middleware/rateLimiter');
const IdempotencyService = require('../services/idempotencyService');
const { 
  authenticateToken: authMiddleware, 
  isAdmin: adminMiddleware,
  isManager: managerMiddleware,
  optionalAuth
} = require('../middleware/auth');
const { requireBranchAccess, ensureBranchId } = require('../middleware/branchAuth');
const validateOrderBranch = require('../middleware/validateOrderBranch');
const { healthGuard } = require('../middleware/healthGuard');
const workingHoursGuard = require('../middleware/workingHoursGuard');
const { validateId } = require('../utils/security');
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
  validateCancelOrder
} = require('../middleware/orderValidation');

const idempotency = require('../services/idempotencyService');

const router = express.Router();

// Allow guests (app) to create orders while identifying registered customers
router.post('/', idempotency.guard(true), optionalAuth, validateOrderBranch, healthGuard('db'), workingHoursGuard, orderLimiter, createOrder);

// New Secure Identity Route: Get orders for the authenticated customer
router.get('/my-orders', authMiddleware, getMyOrders);

// Report endpoint with date filtering (no row limit)
router.get('/report', authMiddleware, adminMiddleware, requireBranchAccess, getOrdersReport);

// Only admin/manager can view and update
router.get('/', authMiddleware, managerMiddleware, requireBranchAccess, getOrders);
router.get('/sync', authMiddleware, managerMiddleware, requireBranchAccess, syncOrders);
router.post('/accept-all', authMiddleware, managerMiddleware, requireBranchAccess, idempotency.guard(true), acceptAllNewOrders);
router.patch('/:id/status', authMiddleware, managerMiddleware, requireBranchAccess, healthGuard('db'), idempotency.guard(true), validateId(), updateOrderStatus);
router.patch('/:id/timer', authMiddleware, managerMiddleware, requireBranchAccess, idempotency.guard(true), validateId(), updateOrderTimer);
router.patch('/:id/prep-time', authMiddleware, managerMiddleware, requireBranchAccess, idempotency.guard(true), validateId(), updatePreparationTime);
router.patch('/:id/rate', authMiddleware, idempotency.guard(true), validateId(), submitOrderRating);

// Cancel order (Unified logic for Customer and Admin)
router.post('/:id/cancel', authMiddleware, requireBranchAccess, idempotency.guard(true), cancelOrder);
router.post('/:id/approve-cancel', authMiddleware, managerMiddleware, requireBranchAccess, idempotency.guard(true), approveCancellation);
router.post('/:id/reject-cancel', authMiddleware, managerMiddleware, requireBranchAccess, idempotency.guard(true), rejectCancellation);

router.post('/:id/handle-cancellation', authMiddleware, managerMiddleware, requireBranchAccess, idempotency.guard(true), validateId(), handleCancellationRequest);

// --- Partial Cancellation ---

// Request from Customer
router.post(
  "/:orderId/partial-cancel",
  authMiddleware,
  idempotency.guard(true),
  validateId('orderId'),
  validatePartialCancelRequest,
  requestPartialCancel
);

// Decision from Admin
router.post(
  "/:orderId/handle-partial-cancel",
  authMiddleware,
  managerMiddleware,
  requireBranchAccess,
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
