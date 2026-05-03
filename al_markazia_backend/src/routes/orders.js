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
const { healthGuard } = require('../middleware/healthGuard');
const workingHoursGuard = require('../middleware/workingHoursGuard');
const { 
  createOrder, 
  getOrders,
  getOrdersReport,
  getMyOrders,
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

const logger = require('../utils/logger');
const { validateId } = require('../utils/security');

const router = express.Router();

// Allow guests (app) to create orders while identifying registered customers
router.post('/', optionalAuth, healthGuard('db'), workingHoursGuard, orderLimiter, createOrder);

// New Secure Identity Route: Get orders for the authenticated customer
router.get('/my-orders', authMiddleware, getMyOrders);

// Report endpoint with date filtering (no row limit)
router.get('/report', authMiddleware, adminMiddleware, requireBranchAccess, getOrdersReport);

// Only admin/manager can view and update
router.get('/', authMiddleware, managerMiddleware, requireBranchAccess, getOrders);
router.post('/accept-all', authMiddleware, managerMiddleware, requireBranchAccess, acceptAllNewOrders);
router.patch('/:id/status', authMiddleware, managerMiddleware, healthGuard('db'), validateId(), updateOrderStatus);
router.patch('/:id/timer', authMiddleware, managerMiddleware, validateId(), updateOrderTimer);
router.patch('/:id/prep-time', authMiddleware, managerMiddleware, validateId(), updatePreparationTime);
router.patch('/:id/rate', authMiddleware, validateId(), submitOrderRating);

// 🛡️ Cancellation Engine Endpoints
router.post('/:id/cancel', authMiddleware, IdempotencyService.guard(), cancelOrder);
router.post('/:id/approve-cancel', authMiddleware, managerMiddleware, requireBranchAccess, IdempotencyService.guard(), approveCancellation);
router.post('/:id/reject-cancel', authMiddleware, managerMiddleware, requireBranchAccess, IdempotencyService.guard(), rejectCancellation);

router.post('/:id/handle-cancellation', authMiddleware, managerMiddleware, requireBranchAccess, validateId(), handleCancellationRequest);

// --- Partial Cancellation ---

// Request from Customer
router.post(
  "/:orderId/partial-cancel",
  authMiddleware,
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
