const express = require('express');
const { orderLimiter } = require('../middleware/rateLimiter');
const { 
  authenticateToken: authMiddleware, 
  isAdmin: adminMiddleware,
  optionalAuth
} = require('../middleware/auth');
const { healthGuard } = require('../middleware/healthGuard');
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
  handleCancellationRequest,
  requestPartialCancel,
  handlePartialCancelRequest,
  getPendingPartialCancels
} = require('../controllers/orderController');

const {
  validatePartialCancelRequest,
  validateHandlePartialCancel,
  validateCancelOrder
} = require('../middleware/orderValidation');

const logger = require('../utils/logger');

const router = express.Router();

// Allow guests (app) to create orders while identifying registered customers
router.post('/', optionalAuth, healthGuard('db'), orderLimiter, createOrder);

// New Secure Identity Route: Get orders for the authenticated customer
router.get('/my-orders', authMiddleware, getMyOrders);

// Report endpoint with date filtering (no row limit)
router.get('/report', authMiddleware, adminMiddleware, getOrdersReport);

// Only admin can view and update
router.get('/', authMiddleware, adminMiddleware, getOrders);
router.post('/accept-all', authMiddleware, adminMiddleware, acceptAllNewOrders);
router.patch('/:id/status', authMiddleware, adminMiddleware, healthGuard('db'), updateOrderStatus);
router.patch('/:id/timer', authMiddleware, adminMiddleware, updateOrderTimer);
router.patch('/:id/rate', authMiddleware, submitOrderRating);

// Full Cancellation
router.post('/:id/cancel', authMiddleware, healthGuard('db'), validateCancelOrder, cancelOrder);

router.post('/:id/handle-cancellation', authMiddleware, adminMiddleware, handleCancellationRequest);

// --- Partial Cancellation ---

// Request from Customer
router.post(
  "/:orderId/partial-cancel",
  authMiddleware,
  validatePartialCancelRequest,
  requestPartialCancel
);

// Decision from Admin
router.post(
  "/:orderId/handle-partial-cancel",
  authMiddleware,
  adminMiddleware,
  validateHandlePartialCancel,
  handlePartialCancelRequest
);

// Admin List Review
router.get(
  "/pending-partial-cancels",
  authMiddleware,
  adminMiddleware,
  getPendingPartialCancels
);

// LEGACY route removed for security.

module.exports = router;
