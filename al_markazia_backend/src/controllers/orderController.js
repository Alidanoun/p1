const container = require('../lib/container');
const logger = container.logger;
const orderService = container.orderService;
const contractGateway = container.contractGateway;

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
    const result = await orderService.getOrders({
      ...req.query,
      userId: req.user.id
    });
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
    const result = await orderService.getOrdersReport({
      ...req.query,
      userId: req.user.id
    });
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
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];

  try {
    const authUser = req.user;
    if (!authUser && !req.body.phone) {
      return res.status(400).json({ success: false, error: 'رقم الهاتف مطلوب لإتمام الطلب كضيف' });
    }

    const validatedBranchId = req.validatedBranch?.id;

    const contractGateway = require('../services/contractGateway');
    const newOrder = await contractGateway.execute(
      null, // no orderId for creation
      'CREATE_ORDER',
      {
        orderData: { ...req.body, branchId: validatedBranchId },
        cartItems: req.body.cartItems || req.body.items,
        idempotencyKey: idempotencyKey || `create_${authUser?.id || 'guest'}_${Date.now()}`
      },
      authUser || { id: `guest_${req.ip}`, role: 'customer' }
    );

    res.status(201).json({ success: true, data: newOrder });
  } catch (error) {
    logger.error('Order Creation Error', { error: error.message });
    
    // 🛡️ Security Error Handling
    if (error.message === 'UNAUTHORIZED_GUEST_ORDER_TYPE') {
      return res.status(403).json({ success: false, error: 'نوع الطلب غير مسموح للزوار' });
    }
    if (error.message === 'BRANCH_ACCESS_DENIED') {
      return res.status(403).json({ success: false, error: 'غير مصرح لك بإنشاء طلبات في هذا الفرع' });
    }
    if (error.message.startsWith('BRANCH_CLOSED') || error.message.startsWith('BRANCH_NOT_OPERATIONAL')) {
      return res.status(400).json({ success: false, error: 'الفرع مغلق حالياً، يرجى اختيار فرع آخر' });
    }
    if (error.message.includes('INVALID_BRANCH') || error.message.startsWith('BRANCH_NOT_FOUND') || error.message.startsWith('BRANCH_ID_REQUIRED')) {
      return res.status(400).json({ success: false, error: 'الفرع المحدد غير موجود أو غير متاح' });
    }
    if (error.message.startsWith('CONTRACT_VIOLATION')) {
      return res.status(400).json({ success: false, error: 'بيانات الطلب غير مكتملة أو غير صالحة' });
    }
    if (error.message === 'CUSTOMER_BLACKLISTED') {
      return res.status(403).json({ success: false, error: 'تم حظر حسابك مؤقتاً بسبب نشاط مشبوه' });
    }
    if (error.message === 'SPAM_LIMIT_EXCEEDED') {
      return res.status(429).json({ success: false, error: 'تجاوزت الحد المسموح من الطلبات. حاول لاحقاً' });
    }
    if (error.message === 'EMPTY_ORDER_NOT_ALLOWED') {
      return res.status(400).json({ success: false, error: 'لا يمكن إنشاء طلب فارغ' });
    }
    if (error.message.includes('SYSTEM_LOCKED')) {
      return res.status(503).json({ success: false, error: 'النظام في وضع الصيانة، حاول لاحقاً' });
    }
    if (error.message.includes('SYSTEM_DEGRADED')) {
      return res.status(503).json({ success: false, error: 'النظام تحت ضغط، حاول بعد 30 ثانية' });
    }
    if (error.message.includes('SYSTEM_BUSY')) {
      return res.status(429).json({ success: false, error: 'طلب مماثل قيد المعالجة' });
    }
    
    res.status(500).json({ success: false, error: 'فشل إنشاء الطلب' });
  }
};

/**
 * Batch Accept (One-click confirmation) — via ContractGateway
 */
exports.acceptAllNewOrders = async (req, res) => {
  try {
    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(
      null, // batch operation — no single orderId
      'BATCH_ACCEPT',
      {
        idempotencyKey: req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || `batch_${req.user.id}_${Date.now()}`
      },
      req.user
    );
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Batch accept error', { error: error.message });
    if (error.message === 'UNAUTHORIZED_BATCH_ACCEPT') {
      return res.status(403).json({ error: 'غير مصرح لك بهذه العملية' });
    }
    if (error.message.startsWith('BATCH_TOO_LARGE')) {
      return res.status(400).json({ error: error.message });
    }
    if (error.message.includes('SYSTEM_LOCKED')) {
      return res.status(503).json({ error: 'النظام في وضع الصيانة' });
    }
    res.status(500).json({ error: 'Batch operation failed' });
  }
};

exports.syncOrders = async (req, res) => {
  try {
    const clientVersion = req.query.version || '0';
    const result = await orderService.syncOrders(req.user, clientVersion);
    res.json(result);
  } catch (error) {
    logger.error('Sync orders error', { error: error.message });
    res.status(500).json({ error: error.message });
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
    const idempotencyKey = req.headers['idempotency-key'] || `timer_${orderId}_${Date.now()}`;

    if (isNaN(orderId)) return res.status(400).json({ error: 'معرف الطلب غير صحيح' });

    // 🛡️ Early validation — prevent unnecessary lock acquisition on invalid input
    if (!estimatedReadyAt || isNaN(new Date(estimatedReadyAt).getTime())) {
      return res.status(400).json({ error: 'تاريخ غير صالح', code: 'INVALID_DATE' });
    }

    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(orderId, 'UPDATE_TIMER', {
      estimatedReadyAt,
      idempotencyKey
    }, req.user);

    res.json(result);
  } catch (error) {
    logger.error('updateOrderTimer error', { error: error.message });
    if (error.message === 'INVALID_DATE') return res.status(400).json({ error: 'تاريخ غير صالح' });
    if (error.message === 'ORDER_FORBIDDEN' || error.message === 'UNAUTHORIZED_ORDER_ACCESS') {
      return res.status(403).json({ error: 'غير مصرح لك بتعديل هذا الطلب' });
    }
    res.status(500).json({ error: 'Failed to update timer' });
  }
};

/**
 * ⭐ Submit Order Rating
 */
exports.submitOrderRating = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { rating, comment } = req.body;
    const idempotencyKey = req.headers['x-idempotency-key'] || req.headers['idempotency-key'] || `rate_${orderId}_${req.user.id}`;

    if (isNaN(orderId)) return res.status(400).json({ error: 'معرف طلب غير صحيح' });

    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(orderId, 'SUBMIT_RATING', {
      rating,
      comment,
      idempotencyKey
    }, req.user);

    res.json(result);
  } catch (error) {
    logger.error('submitOrderRating error', { error: error.message });
    if (error.message === 'INVALID_RATING') return res.status(400).json({ error: 'التقييم يجب أن يكون رقماً بين 1 و 5' });
    if (error.message === 'ORDER_NOT_FOUND') return res.status(404).json({ error: 'الطلب غير موجود' });
    if (error.message === 'ORDER_FORBIDDEN' || error.message === 'UNAUTHORIZED_ORDER_ACCESS') {
      return res.status(403).json({ error: 'غير مصرح لك بتقييم هذا الطلب' });
    }
    res.status(500).json({ error: 'Failed to submit rating' });
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { reason, managerPassword, isRestaurantFault } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || `cancel_manual_${orderId}_${Date.now()}`;

    const configService = require('../services/configService');
    const systemConfig = await configService.getFullConfig();
    const maxLen = systemConfig.business.maxCancellationReasonLength;

    if (reason && reason.length > maxLen) {
      return res.status(400).json({ error: `سبب الإلغاء يتجاوز الحد المسموح (${maxLen} حرف)` });
    }

    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(orderId, 'CANCEL', {
      reason,
      managerPassword, // 🛡️ [SEC-FIX] Pass to gateway for verification
      idempotencyKey
    }, req.user);

    res.json(result);
  } catch (error) {
    logger.error('cancelOrder error', { error: error.message });
    if (error.message === 'ORDER_NOT_FOUND') return res.status(404).json({ error: 'الطلب غير موجود' });
    if (error.message === 'ORDER_FORBIDDEN') return res.status(403).json({ error: 'غير مصرح لك بإلغاء هذا الطلب' });
    if (error.message === 'CANCELLATION_ALREADY_REQUESTED') return res.status(400).json({ error: 'تم إرسال طلب إلغاء مسبقاً' });
    res.status(500).json({ error: 'فشل عملية الإلغاء' });
  }
};

exports.approveCancellation = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const idempotencyKey = req.headers['idempotency-key'] || `approve_cancel_${orderId}_${Date.now()}`;
    
    const { managerPassword } = req.body;
    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(orderId, 'APPROVE_CANCEL', { managerPassword, idempotencyKey }, req.user);
    
    res.json(result);
  } catch (error) {
    logger.error('approveCancellation error', { error: error.message });
    if (error.message === 'CANCELLATION_NOT_FOUND') return res.status(404).json({ error: 'طلب الإلغاء غير موجود' });
    if (error.message === 'ADMIN_APPROVAL_REQUIRED') return res.status(403).json({ error: 'موافقة الإدارة العامة مطلوبة لهذا الإلغاء' });
    res.status(500).json({ error: 'فشل الموافقة على الإلغاء' });
  }
};

exports.rejectCancellation = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { rejectionReason } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || `reject_cancel_${orderId}_${Date.now()}`;
    
    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(orderId, 'REJECT_CANCEL', { rejectionReason, idempotencyKey }, req.user);
    
    res.json(result);
  } catch (error) {
    logger.error('rejectCancellation error', { error: error.message });
    res.status(500).json({ error: 'فشل رفض طلب الإلغاء' });
  }
};

/**
 * Handle cancellation request (approve/reject from admin)
 */
exports.handleCancellationRequest = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { action, rejectionReason } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || `handle_cancel_${orderId}_${action}_${Date.now()}`;

    if (isNaN(orderId)) return res.status(400).json({ error: 'معرف طلب غير صحيح' });

    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(orderId, 'HANDLE_CANCEL', {
      cancelAction: action,
      rejectionReason,
      idempotencyKey
    }, req.user);

    res.json(result || { success: true });
  } catch (error) {
    logger.error('handleCancellationRequest failed', { error: error.message });
    if (error.message === 'ORDER_NOT_FOUND') return res.status(404).json({ error: 'Order not found' });
    if (error.message === 'NOT_PENDING_CANCELLATION') return res.status(400).json({ error: 'Order is not pending cancellation' });
    if (error.message === 'UNAUTHORIZED_ORDER_ACCESS') return res.status(403).json({ error: 'Unauthorized access' });
    res.status(500).json({ error: 'Failed to handle cancellation request' });
  }
};

/**
 * Partial Cancellation Request — via ContractGateway
 */
exports.requestPartialCancel = async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const { items, reason } = req.body;

    // Early input validation
    if (isNaN(orderId)) return res.status(400).json({ error: 'معرف طلب غير صحيح' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items must be a non-empty array' });
    }
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'سبب الإلغاء مطلوب' });
    }

    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(
      orderId,
      'REQUEST_PARTIAL_CANCEL',
      {
        items,
        reason,
        idempotencyKey: req.headers['idempotency-key'] || `partial_cancel_${orderId}_${req.user.id}`
      },
      req.user
    );

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('requestPartialCancel error', { error: error.message });
    if (error.message === 'ORDER_NOT_FOUND') return res.status(404).json({ error: 'Order not found' });
    if (error.message === 'NOT_YOUR_ORDER') return res.status(403).json({ error: 'هذا الطلب ليس لك' });
    if (error.message === 'BRANCH_ACCESS_DENIED') return res.status(403).json({ error: 'غير مصرح لك بالوصول لهذا الفرع' });
    if (error.message.startsWith('INVALID_STATE')) return res.status(400).json({ error: 'الطلب في حالة لا تسمح بالإلغاء الجزئي' });
    if (error.message.startsWith('INVALID_ITEMS')) return res.status(400).json({ error: 'بعض العناصر غير موجودة في الطلب' });
    if (error.message === 'ITEMS_REQUIRED') return res.status(400).json({ error: 'يجب تحديد العناصر المراد إلغاؤها' });
    if (error.message === 'INVALID_REFUND_AMOUNT') return res.status(400).json({ error: 'مبلغ الاسترداد غير صالح' });
    if (error.message === 'UNAUTHORIZED_ORDER_ACCESS') return res.status(403).json({ error: 'غير مصرح لك' });
    res.status(500).json({ error: 'Failed to request partial cancel' });
  }
};

exports.handlePartialCancelRequest = async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const { action, notificationId, reason, itemsToCancel, managerPassword } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || `handle_partial_${notificationId}_${Date.now()}`;

    if (isNaN(orderId)) return res.status(400).json({ error: 'معرف الطلب غير صحيح' });
    if (!notificationId) return res.status(400).json({ error: 'معرف الإشعار مطلوب' });

    const contractGateway = require('../services/contractGateway');
    const gatewayAction = action === 'approve' ? 'APPROVE_PARTIAL_CANCEL' : 'REJECT_PARTIAL_CANCEL';
    
    const result = await contractGateway.execute(orderId, gatewayAction, {
      notificationId,
      reason,
      itemsToCancel,
      managerPassword,
      idempotencyKey
    }, req.user);

    res.json(result);
  } catch (error) {
    logger.error('handlePartialCancelRequest error', { error: error.message });
    if (error.message === 'ORDER_NOT_FOUND') return res.status(404).json({ error: 'الطلب غير موجود' });
    if (error.message.startsWith('INVALID_STATE')) return res.status(400).json({ error: 'حالة الطلب لا تسمح بهذا التعديل' });
    if (error.message.startsWith('INVALID_ITEMS')) return res.status(400).json({ error: 'العناصر المحددة غير صالحة' });
    if (error.message === 'UNAUTHORIZED_ORDER_ACCESS') return res.status(403).json({ error: 'غير مصرح لك بالوصول لهذا الفرع' });
    res.status(500).json({ error: 'فشل معالجة الطلب' });
  }
};

exports.getPendingPartialCancels = async (req, res) => {
  try {
    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(null, 'GET_PENDING_PARTIAL_CANCELS', {}, req.user);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('getPendingPartialCancels error', { error: error.message });
    res.status(500).json({ error: 'فشل جلب الطلبات المعلقة' });
  }
};

/**
 * ⚡ Atomic Status Update Helper (Legacy Wrapper)
 * @deprecated Route through ContractGateway for full protection.
 * Will be removed after 2 weeks of monitoring (target: 2026-05-18).
 */
exports.performStatusUpdate = async (orderId, newStatus) => {
  logger.warn('DEPRECATED_ENDPOINT_USED: performStatusUpdate', {
    orderId,
    newStatus,
    caller: new Error().stack
  });

  const contractGateway = require('../services/contractGateway');
  return contractGateway.execute(
    orderId,
    'LEGACY_STATUS_UPDATE',
    { newStatus, idempotencyKey: `legacy_status_${orderId}_${Date.now()}` },
    { id: 'LEGACY_SYSTEM', role: 'system' }
  );
};

exports.getCustomerOrders = exports.getOrders;

exports.updatePreparationTime = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { minutes } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || `prep_${orderId}_${Date.now()}`;

    if (isNaN(orderId)) return res.status(400).json({ error: 'معرف طلب غير صحيح' });

    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(orderId, 'UPDATE_PREP_TIME', {
      minutes,
      idempotencyKey
    }, req.user);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('updatePreparationTime error', { error: error.message });
    if (error.message === 'ORDER_FORBIDDEN' || error.message === 'UNAUTHORIZED_ORDER_ACCESS') {
      return res.status(403).json({ error: 'غير مصرح لك بتعديل هذا الطلب' });
    }
    res.status(500).json({ success: false, error: 'Failed to update preparation time' });
  }
};
