const logger = require('../utils/logger');
const IdempotencyService = require('../services/idempotencyService');
const orderService = require('../services/orderService');

/**
 * 🥡 Order Controller (Performance Optimized)
 */

/**
 * Fetch authenticated customer orders
 */
exports.getMyOrders = async (req, res) => {
  try {
    const result = await orderService.getCustomerOrders(req.user.id, req.query);
    res.json({
      success: true,
      data: result.orders,
      pagination: { 
        total: result.total, 
        page: result.page, 
        limit: result.limit, 
        pages: Math.ceil(result.total / result.limit), 
        hasMore: (result.page * result.limit) < result.total 
      }
    });
  } catch (error) {
    logger.error('Fetch my orders error', { error: error.message });
    if (error.message === 'CUSTOMER_NOT_FOUND') return res.status(404).json({ error: 'ملف الزبون غير موجود' });
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

/**
 * Admin: Filtered Order Fetch (With Search & Status Aggregation)
 */
exports.getOrders = async (req, res) => {
  try {
    const result = await orderService.getOrders(req.query);
    res.json({
      success: true,
      data: result.orders,
      pagination: { 
        total: result.total, 
        page: result.page, 
        limit: result.limit, 
        pages: Math.ceil(result.total / result.limit) 
      },
      statusSummary: result.statusSummary
    });
  } catch (error) {
    logger.error('Fetch admin orders error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

/**
 * Admin: Reports Endpoint (Optimized for Exports)
 */
exports.getOrdersReport = async (req, res) => {
  try {
    const result = await orderService.getOrdersReport(req.query);
    res.json({
      success: true,
      data: result.orders,
      summary: result.summary,
      pagination: result.page ? { total: result.total, page: result.page, limit: result.limit } : { total: result.total, limit: result.limit }
    });
  } catch (error) {
    logger.error('Report fetch error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch report data' });
  }
};

/**
 * Fetch Single Order with full details
 */
exports.getOrderById = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    if (isNaN(orderId)) return res.status(400).json({ error: 'معرف طلب غير صحيح' });

    const order = await orderService.getOrderById(orderId, req.user);
    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });

    res.json({ success: true, data: order });
  } catch (error) {
    logger.error('Fetch order by ID error', { error: error.message, orderId: req.params.id });
    if (error.message === 'ORDER_FORBIDDEN') return res.status(404).json({ error: 'الطلب غير موجود' });
    res.status(500).json({ success: false, error: 'Failed to fetch order' });
  }
};

/**
 * Standard CRUD & Status Handlers (Delegated or Optimized)
 */

exports.createOrder = async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (idempotencyKey) {
    const lock = await IdempotencyService.startRequest(idempotencyKey);
    if (lock.status === 'completed') return res.status(lock.result.code).json(lock.result.body);
    if (lock.status === 'processing') return res.status(425).json({ success: false, message: 'طلب مكرر قيد المعالجة' });
  }

  try {
    const authUser = req.user;
    if (!authUser && !req.body.phone) {
      const response = { success: false, error: 'رقم الهاتف مطلوب لإتمام الطلب كضيف' };
      if (idempotencyKey) await IdempotencyService.resolveRequest(idempotencyKey, 400, response);
      return res.status(400).json(response);
    }

    const newOrder = await orderService.createOrder(req.body, authUser);
    const response = { success: true, data: newOrder };
    if (idempotencyKey) await IdempotencyService.resolveRequest(idempotencyKey, 201, response);
    res.status(201).json(response);
  } catch (error) {
    logger.error('Order Creation Error', { error: error.message });
    res.status(500).json({ success: false, error: 'فشل إنشاء الطلب' });
  }
};

/**
 * Batch Accept (One-click confirmation)
 */
exports.acceptAllNewOrders = async (req, res) => {
  try {
    const adminEmail = req.user?.email || 'Admin';
    const result = await orderService.batchAcceptOrders(adminEmail);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Batch accept error', { error: error.message });
    res.status(500).json({ error: 'Batch operation failed' });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { status, version } = req.body;
    const idempotencyKey = req.headers['idempotency-key'];

    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'معرف الطلب غير صحيح' });
    }

    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(orderId, 'UPDATE_STATUS', {
      status,
      version,
      idempotencyKey
    }, req.user);

    if (!result) {
      return res.status(400).json({ error: 'فشل تحديث الحالة' });
    }
    
    return res.json(result);
  } catch (error) {
    logger.error('updateOrderStatus error', { error: error.message });
    
    if (error.message.includes('Invalid status transition')) {
      return res.status(400).json({ error: 'انتقال غير صالح لحالة الطلب' });
    }
    
    if (error.message === 'CONCURRENCY_CONFLICT') {
      return res.status(409).json({ error: 'تم تحديث الطلب من قبل موظف آخر. يرجى تحديث الصفحة' });
    }

    return res.status(500).json({ error: 'فشل تحديث حالة الطلب' });
  }
};

/**
 * ⏲️ Update estimated ready time (Admin)
 */
exports.updateOrderTimer = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { estimatedReadyAt } = req.body;
    
    const result = await orderService.updateOrderTimer(orderId, estimatedReadyAt);
    res.json(result);
  } catch (error) {
    logger.error('updateOrderTimer error', { error: error.message });
    if (error.message === 'INVALID_DATE') return res.status(400).json({ error: 'تاريخ غير صالح' });
    res.status(500).json({ error: 'Failed to update timer' });
  }
};

/**
 * ⭐ Submit Order Rating
 */
exports.submitOrderRating = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const orderId = parseInt(req.params.id);

    const result = await orderService.submitOrderRating(orderId, req.user, rating, comment);
    res.json(result);
  } catch (error) {
    logger.error('submitOrderRating error', { error: error.message });
    if (error.message === 'INVALID_RATING') return res.status(400).json({ error: 'التقييم يجب أن يكون رقماً بين 1 و 5' });
    if (error.message === 'ORDER_NOT_FOUND') return res.status(404).json({ error: 'الطلب غير موجود' });
    if (error.message === 'ORDER_FORBIDDEN') return res.status(403).json({ error: 'غير مصرح لك بتقييم هذا الطلب' });
    res.status(500).json({ error: 'Failed to submit rating' });
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { reason, managerPassword, isRestaurantFault } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || `cancel_manual_${orderId}_${Date.now()}`;

    if (reason && reason.length > 500) {
      return res.status(400).json({ error: 'سبب الإلغاء يتجاوز الحد المسموح (500 حرف)' });
    }

    const contractGateway = require('../services/contractGateway');
    const updatedOrder = await contractGateway.execute(orderId, 'CANCEL', {
      reason,
      managerPassword,
      isRestaurantFault,
      idempotencyKey
    }, req.user);

    return res.json(updatedOrder);
  } catch (error) {
    logger.error('cancelOrder failed', { error: error.message });

    const errorMap = {
      'ORDER_NOT_FOUND': ['الطلب غير موجود', 404],
      'MANAGER_PASSWORD_REQUIRED': ['كلمة مرور المدير مطلوبة لإلغاء طلب نشط', 400],
      'INVALID_MANAGER_PASSWORD': ['كلمة مرور المدير غير صحيحة', 401],
      'CONCURRENCY_CONFLICT': ['تم تعديل الطلب من قبل مستخدم آخر، يرجى التحديث', 409]
    };

    const [msg, status] = errorMap[error.message] || ['فشل إلغاء الطلب', 500];
    return res.status(status).json({ error: msg });
  }
};

/**
 * Handle cancellation request (approve/reject from admin)
 */
exports.handleCancellationRequest = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { action, rejectionReason } = req.body;

    const result = await orderService.handleCancellationRequest(orderId, req.user, action, rejectionReason);
    res.json(result || { success: true });
  } catch (error) {
    logger.error('handleCancellationRequest failed', { error: error.message });
    if (error.message === 'ORDER_NOT_FOUND') return res.status(404).json({ error: 'Order not found' });
    if (error.message === 'NOT_PENDING_CANCELLATION') return res.status(400).json({ error: 'Order is not pending cancellation' });
    res.status(500).json({ error: 'Failed to handle cancellation request' });
  }
};

/**
 * Partial Cancellation Handlers
 */
exports.requestPartialCancel = async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const { items, reason } = req.body;

    const result = await orderService.requestPartialCancel(orderId, items, reason);
    res.json({ success: true, message: 'تم إرسال طلب التعديل للإدارة' });
  } catch (error) {
    logger.error('requestPartialCancel error', { error: error.message });
    if (error.message === 'ORDER_NOT_FOUND') return res.status(404).json({ error: 'Order not found' });
    res.status(500).json({ error: 'Failed to request partial cancel' });
  }
};

exports.handlePartialCancelRequest = async (req, res) => {
  res.json({ message: 'تم استلام الطلب، جاري مراجعته من قبل الإدارة' });
};

exports.getPendingPartialCancels = async (req, res) => {
  res.json([]);
};

/**
 * ⚡ Atomic Status Update Helper (Legacy Wrapper)
 * @deprecated Use orderService.updateOrderStatus instead
 */
exports.performStatusUpdate = async (orderId, newStatus) => {
  return orderService.updateOrderStatus(orderId, newStatus);
};

exports.getCustomerOrders = exports.getOrders;

exports.updatePreparationTime = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { minutes } = req.body;
    const order = await orderService.updatePreparationTime(orderId, minutes);
    res.json({ success: true, data: order });
  } catch (error) {
    logger.error('updatePreparationTime error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update preparation time' });
  }
};
