const container = require('../lib/container');
const logger = container.logger;
const orderService = container.orderService;
const contractGateway = container.contractGateway;
const response = require('../utils/response');

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
    if (error.message === 'CUSTOMER_NOT_FOUND') {
      return response.error(res, 'ملف الزبون غير موجود', 'CUSTOMER_NOT_FOUND', 404);
    }
    return response.error(res, 'Failed to fetch orders', 'FETCH_ERROR', 500);
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
    return response.error(res, 'Failed to fetch orders', 'FETCH_ERROR', 500);
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
    return response.error(res, 'Failed to fetch report data', 'REPORT_ERROR', 500);
  }
};

/**
 * Fetch Single Order with full details
 */
exports.getOrderById = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    if (isNaN(orderId)) {
      return response.error(res, 'معرف طلب غير صحيح', 'INVALID_ID', 400);
    }

    const order = await orderService.getOrderById(orderId, req.user);
    if (!order) {
      return response.error(res, 'الطلب غير موجود', 'NOT_FOUND', 404);
    }

    res.json({ success: true, data: order });
  } catch (error) {
    logger.error('Fetch order by ID error', { error: error.message, orderId: req.params.id });
    if (error.message === 'ORDER_FORBIDDEN') {
      return response.error(res, 'الطلب غير موجود', 'NOT_FOUND', 404);
    }
    return response.error(res, 'Failed to fetch order', 'FETCH_ERROR', 500);
  }
};

/**
 * Standard CRUD & Status Handlers (Delegated or Optimized)
 */

exports.createOrder = async (req, res) => {
  // Idempotency key is enforced by middleware guard — must be a valid UUID
  const idempotencyKey = req.idempotencyKey;

  try {
    const authUser = req.user;

    const validatedBranchId = req.validatedBranch?.id || req.body?.branchId || req.body?.branch;

    const contractGateway = require('../services/contractGateway');
    const newOrder = await contractGateway.execute(
      null,
      'CREATE_ORDER',
      {
        orderData: { ...req.body, branchId: validatedBranchId },
        cartItems: req.body.cartItems || req.body.items,
        idempotencyKey
      },
      authUser
    );

    return response.success(res, newOrder, 201);
  } catch (error) {
    logger.error('Order Creation Error', { error: error.message });
    
    // 🛡️ Security Error Handling
    if (error.message === 'UNAUTHORIZED_GUEST_ORDER_TYPE') {
      return response.error(res, 'نوع الطلب غير مسموح للزوار', 'UNAUTHORIZED_GUEST_ORDER_TYPE', 403);
    }
    if (error.message === 'BRANCH_ACCESS_DENIED') {
      return response.error(res, 'غير مصرح لك بإنشاء طلبات في هذا الفرع', 'BRANCH_ACCESS_DENIED', 403);
    }
    if (error.message.startsWith('BRANCH_CLOSED') || error.message.startsWith('BRANCH_NOT_OPERATIONAL')) {
      return response.error(res, 'الفرع مغلق حالياً، يرجى اختيار فرع آخر', 'BRANCH_CLOSED', 400);
    }
    if (error.message.includes('INVALID_BRANCH') || error.message.startsWith('BRANCH_NOT_FOUND') || error.message.startsWith('BRANCH_ID_REQUIRED')) {
      return response.error(res, 'الفرع المحدد غير موجود أو غير متاح', 'INVALID_BRANCH', 400);
    }
    if (error.message.startsWith('CONTRACT_VIOLATION')) {
      return response.error(res, 'بيانات الطلب غير مكتملة أو غير صالحة', 'CONTRACT_VIOLATION', 400);
    }
    if (error.message === 'CUSTOMER_BLACKLISTED') {
      return response.error(res, 'تم حظر حسابك مؤقتاً بسبب نشاط مشبوه', 'CUSTOMER_BLACKLISTED', 403);
    }
    if (error.message === 'SPAM_LIMIT_EXCEEDED') {
      return response.error(res, 'تجاوزت الحد المسموح من الطلبات. حاول لاحقاً', 'SPAM_LIMIT_EXCEEDED', 429);
    }
    if (error.message === 'EMPTY_ORDER_NOT_ALLOWED') {
      return response.error(res, 'لا يمكن إنشاء طلب فارغ', 'EMPTY_ORDER_NOT_ALLOWED', 400);
    }
    if (error.message.includes('SYSTEM_LOCKED')) {
      return response.error(res, 'النظام في وضع الصيانة، حاول لاحقاً', 'SYSTEM_LOCKED', 503);
    }
    if (error.message.includes('SYSTEM_DEGRADED')) {
      return response.error(res, 'النظام تحت ضغط، حاول بعد 30 ثانية', 'SYSTEM_DEGRADED', 503);
    }
    if (error.message.includes('SYSTEM_BUSY')) {
      return response.error(res, 'طلب مماثل قيد المعالجة', 'SYSTEM_BUSY', 429);
    }
    if (error.message.startsWith('AUTH_REQUIRED')) {
      return response.error(res, 'يجب تسجيل الدخول لإتمام الطلب', 'AUTH_REQUIRED', 401);
    }
    if (error.message.startsWith('ITEM_NOT_FOUND')) {
      return response.error(res, 'بعض الأصناف غير موجودة', 'ITEM_NOT_FOUND', 400);
    }
    if (error.message.startsWith('ITEM_UNAVAILABLE') || error.message.startsWith('ITEM_NOT_IN_BRANCH')) {
      return response.error(res, 'بعض الأصناف غير متوفرة حالياً في هذا الفرع', 'ITEM_UNAVAILABLE', 400);
    }
    if (error.message.startsWith('INSUFFICIENT_STOCK')) {
      return response.error(res, 'المخزون لا يكفي لبعض الأصناف', 'INSUFFICIENT_STOCK', 400);
    }
    if (error.message.startsWith('INVALID_QUANTITY')) {
      return response.error(res, 'كمية غير صالحة لبعض الأصناف', 'INVALID_QUANTITY', 400);
    }
    if (error.message.startsWith('INVALID_DELIVERY_ZONE')) {
      return response.error(res, 'منطقة التوصيل غير صالحة', 'INVALID_DELIVERY_ZONE', 400);
    }
    if (error.message.startsWith('MIN_ORDER_NOT_MET')) {
      return response.error(res, 'لم يتم تجاوز الحد الأدنى للطلب', 'MIN_ORDER_NOT_MET', 400);
    }
    
    return response.error(res, 'فشل إنشاء الطلب', 'CREATE_FAILED', 500);
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
      return response.error(res, 'غير مصرح لك بهذه العملية', 'UNAUTHORIZED_BATCH_ACCEPT', 403);
    }
    if (error.message.startsWith('BATCH_TOO_LARGE')) {
      return response.error(res, error.message, 'BATCH_TOO_LARGE', 400);
    }
    if (error.message.includes('SYSTEM_LOCKED')) {
      return response.error(res, 'النظام في وضع الصيانة', 'SYSTEM_LOCKED', 503);
    }
    return response.error(res, 'Batch operation failed', 'BATCH_FAILED', 500);
  }
};

exports.syncOrders = async (req, res) => {
  try {
    const clientVersion = req.query.version || '0';
    const result = await orderService.syncOrders(req.user, clientVersion);
    res.json(result);
  } catch (error) {
    logger.error('Sync orders error', { error: error.message });
    return response.error(res, error.message, 'SYNC_FAILED', 500);
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { status } = req.body;
    let version = parseInt(req.body.version, 10);
    if (isNaN(version)) version = 1; // Default to 1 to trigger 409 concurrency error instead of 500/400 validation error
    const idempotencyKey = req.headers['idempotency-key'];

    if (isNaN(orderId)) {
      return response.error(res, 'معرف الطلب غير صحيح', 'INVALID_ID', 400);
    }

    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(orderId, 'UPDATE_STATUS', {
      status,
      version,
      idempotencyKey
    }, req.user);

    if (!result) {
      return response.error(res, 'فشل تحديث الحالة', 'UPDATE_FAILED', 400);
    }
    
    return res.json(result);
  } catch (error) {
    logger.error('updateOrderStatus error', { error: error.message });
    
    if (error.message.includes('Invalid status transition') || error.message.includes('ILLEGAL_TRANSITION') || error.message.includes('INVALID_STATE')) {
      return response.error(res, 'انتقال غير صالح لحالة الطلب', 'INVALID_TRANSITION', 400);
    }

    if (error.message.includes('CONTRACT_VIOLATION')) {
      return response.error(res, error.message.replace('CONTRACT_VIOLATION: ', ''), 'VALIDATION_ERROR', 400);
    }
    
    if (error.message === 'CONCURRENCY_CONFLICT') {
      return response.error(res, 'تم تحديث الطلب من قبل موظف آخر. يرجى تحديث الصفحة', 'CONCURRENCY_CONFLICT', 409);
    }

    return response.error(res, 'فشل تحديث حالة الطلب', 'SERVER_ERROR', 500);
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

    if (isNaN(orderId)) {
      return response.error(res, 'معرف الطلب غير صحيح', 'INVALID_ID', 400);
    }

    // 🛡️ Early validation — prevent unnecessary lock acquisition on invalid input
    if (!estimatedReadyAt || isNaN(new Date(estimatedReadyAt).getTime())) {
      return response.error(res, 'تاريخ غير صالح', 'INVALID_DATE', 400);
    }

    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(orderId, 'UPDATE_TIMER', {
      estimatedReadyAt,
      idempotencyKey
    }, req.user);

    res.json(result);
  } catch (error) {
    logger.error('updateOrderTimer error', { error: error.message });
    if (error.message === 'INVALID_DATE') {
      return response.error(res, 'تاريخ غير صالح', 'INVALID_DATE', 400);
    }
    if (error.message === 'ORDER_FORBIDDEN' || error.message === 'UNAUTHORIZED_ORDER_ACCESS') {
      return response.error(res, 'غير مصرح لك بتعديل هذا الطلب', 'FORBIDDEN', 403);
    }
    return response.error(res, 'Failed to update timer', 'SERVER_ERROR', 500);
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

    if (isNaN(orderId)) {
      return response.error(res, 'معرف طلب غير صحيح', 'INVALID_ID', 400);
    }

    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(orderId, 'SUBMIT_RATING', {
      rating,
      comment,
      idempotencyKey
    }, req.user);

    res.json(result);
  } catch (error) {
    logger.error('submitOrderRating error', { error: error.message });
    if (error.message === 'INVALID_RATING') {
      return response.error(res, 'التقييم يجب أن يكون رقماً بين 1 و 5', 'INVALID_RATING', 400);
    }
    if (error.message === 'ORDER_NOT_FOUND') {
      return response.error(res, 'الطلب غير موجود', 'ORDER_NOT_FOUND', 404);
    }
    if (error.message === 'ORDER_FORBIDDEN' || error.message === 'UNAUTHORIZED_ORDER_ACCESS') {
      return response.error(res, 'غير مصرح لك بتقييم هذا الطلب', 'FORBIDDEN', 403);
    }
    return response.error(res, 'Failed to submit rating', 'SERVER_ERROR', 500);
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
      return response.error(res, `سبب الإلغاء يتجاوز الحد المسموح (${maxLen} حرف)`, 'REASON_TOO_LONG', 400);
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
    if (error.message === 'ORDER_NOT_FOUND') {
      return response.error(res, 'الطلب غير موجود', 'ORDER_NOT_FOUND', 404);
    }
    if (error.message === 'ORDER_FORBIDDEN') {
      return response.error(res, 'غير مصرح لك بإلغاء هذا الطلب', 'FORBIDDEN', 403);
    }
    if (error.message === 'CANCELLATION_ALREADY_REQUESTED') {
      return response.error(res, 'تم إرسال طلب إلغاء مسبقاً', 'CANCELLATION_ALREADY_REQUESTED', 400);
    }
    return response.error(res, 'فشل عملية الإلغاء', 'CANCEL_FAILED', 500);
  }
};

exports.forceCancelOrder = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { reason, managerPassword } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || `force_cancel_${orderId}_${Date.now()}`;

    if (isNaN(orderId)) {
      return response.error(res, 'معرف الطلب غير صحيح', 'INVALID_ID', 400);
    }

    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(orderId, 'FORCE_CANCEL', {
      reason,
      managerPassword,
      idempotencyKey
    }, req.user);

    // 🕵️ SystemAuditLog registration
    const auditService = require('../services/auditService');
    await auditService.log({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'FORCE_CANCEL_ORDER',
      entityType: 'Order',
      entityId: orderId.toString(),
      status: 'SUCCESS',
      metadata: { reason },
      req
    }).catch(err => logger.error('Failed to log force cancel audit log', { error: err.message }));

    return res.json(result);
  } catch (error) {
    logger.error('forceCancelOrder error', { error: error.message });
    if (error.message === 'ORDER_NOT_FOUND') {
      return response.error(res, 'الطلب غير موجود', 'ORDER_NOT_FOUND', 404);
    }
    return response.error(res, 'فشل عملية الإلغاء القسري', 'FORCE_CANCEL_FAILED', 500);
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
    if (error.message === 'CANCELLATION_NOT_FOUND') {
      return response.error(res, 'طلب الإلغاء غير موجود', 'CANCELLATION_NOT_FOUND', 404);
    }
    if (error.message === 'ADMIN_APPROVAL_REQUIRED') {
      return response.error(res, 'موافقة الإدارة العامة مطلوبة لهذا الإلغاء', 'ADMIN_APPROVAL_REQUIRED', 403);
    }
    return response.error(res, 'فشل الموافقة على الإلغاء', 'APPROVE_FAILED', 500);
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
    return response.error(res, 'فشل رفض طلب الإلغاء', 'REJECT_FAILED', 500);
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

    if (isNaN(orderId)) {
      return response.error(res, 'معرف طلب غير صحيح', 'INVALID_ID', 400);
    }

    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(orderId, 'HANDLE_CANCEL', {
      cancelAction: action,
      rejectionReason,
      idempotencyKey
    }, req.user);

    res.json(result || { success: true });
  } catch (error) {
    logger.error('handleCancellationRequest failed', { error: error.message });
    if (error.message === 'ORDER_NOT_FOUND') {
      return response.error(res, 'Order not found', 'ORDER_NOT_FOUND', 404);
    }
    if (error.message === 'NOT_PENDING_CANCELLATION') {
      return response.error(res, 'Order is not pending cancellation', 'NOT_PENDING_CANCELLATION', 400);
    }
    if (error.message === 'UNAUTHORIZED_ORDER_ACCESS') {
      return response.error(res, 'Unauthorized access', 'FORBIDDEN', 403);
    }
    return response.error(res, 'Failed to handle cancellation request', 'SERVER_ERROR', 500);
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
    if (isNaN(orderId)) {
      return response.error(res, 'معرف طلب غير صحيح', 'INVALID_ID', 400);
    }
    if (!Array.isArray(items) || items.length === 0) {
      return response.error(res, 'items must be a non-empty array', 'INVALID_ITEMS', 400);
    }
    if (!reason || reason.trim().length === 0) {
      return response.error(res, 'سبب الإلغاء مطلوب', 'REASON_REQUIRED', 400);
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
    if (error.message === 'ORDER_NOT_FOUND') {
      return response.error(res, 'Order not found', 'ORDER_NOT_FOUND', 404);
    }
    if (error.message === 'NOT_YOUR_ORDER') {
      return response.error(res, 'هذا الطلب ليس لك', 'FORBIDDEN', 403);
    }
    if (error.message === 'BRANCH_ACCESS_DENIED') {
      return response.error(res, 'غير مصرح لك بالوصول لهذا الفرع', 'FORBIDDEN', 403);
    }
    if (error.message.startsWith('INVALID_STATE')) {
      return response.error(res, 'الطلب في حالة لا تسمح بالإلغاء الجزئي', 'INVALID_STATE', 400);
    }
    if (error.message.startsWith('INVALID_ITEMS')) {
      return response.error(res, 'بعض العناصر غير موجودة في الطلب', 'INVALID_ITEMS', 400);
    }
    if (error.message === 'ITEMS_REQUIRED') {
      return response.error(res, 'يجب تحديد العناصر المراد إلغاؤها', 'ITEMS_REQUIRED', 400);
    }
    if (error.message === 'INVALID_REFUND_AMOUNT') {
      return response.error(res, 'مبلغ الاسترداد غير صالح', 'INVALID_REFUND_AMOUNT', 400);
    }
    if (error.message === 'UNAUTHORIZED_ORDER_ACCESS') {
      return response.error(res, 'غير مصرح لك', 'FORBIDDEN', 403);
    }
    return response.error(res, 'Failed to request partial cancel', 'SERVER_ERROR', 500);
  }
};

exports.handlePartialCancelRequest = async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const { action, notificationId, reason, itemsToCancel, managerPassword } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || `handle_partial_${notificationId}_${Date.now()}`;

    if (isNaN(orderId)) {
      return response.error(res, 'معرف الطلب غير صحيح', 'INVALID_ID', 400);
    }
    if (!notificationId) {
      return response.error(res, 'معرف الإشعار مطلوب', 'MISSING_FIELD', 400);
    }

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
    if (error.message === 'ORDER_NOT_FOUND') {
      return response.error(res, 'الطلب غير موجود', 'ORDER_NOT_FOUND', 404);
    }
    if (error.message.startsWith('INVALID_STATE')) {
      return response.error(res, 'حالة الطلب لا تسمح بهذا التعديل', 'INVALID_STATE', 400);
    }
    if (error.message.startsWith('INVALID_ITEMS')) {
      return response.error(res, 'العناصر المحددة غير صالحة', 'INVALID_ITEMS', 400);
    }
    if (error.message === 'UNAUTHORIZED_ORDER_ACCESS') {
      return response.error(res, 'غير مصرح لك بالوصول لهذا الفرع', 'FORBIDDEN', 403);
    }
    return response.error(res, 'فشل معالجة الطلب', 'SERVER_ERROR', 500);
  }
};

exports.getPendingPartialCancels = async (req, res) => {
  try {
    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(null, 'GET_PENDING_PARTIAL_CANCELS', {}, req.user);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('getPendingPartialCancels error', { error: error.message });
    return response.error(res, 'فشل جلب الطلبات المعلقة', 'SERVER_ERROR', 500);
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

    if (isNaN(orderId)) {
      return response.error(res, 'معرف طلب غير صحيح', 'INVALID_ID', 400);
    }

    const contractGateway = require('../services/contractGateway');
    const result = await contractGateway.execute(orderId, 'UPDATE_PREP_TIME', {
      minutes,
      idempotencyKey
    }, req.user);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('updatePreparationTime error', { error: error.message });
    if (error.message === 'ORDER_FORBIDDEN' || error.message === 'UNAUTHORIZED_ORDER_ACCESS') {
      return response.error(res, 'غير مصرح لك بتعديل هذا الطلب', 'FORBIDDEN', 403);
    }
    return response.error(res, 'Failed to update preparation time', 'SERVER_ERROR', 500);
  }
};

exports.suggestReplacement = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const itemId = parseInt(req.params.itemId);
    const { suggestedReplacementItemId } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || `suggest_${orderId}_${itemId}_${Date.now()}`;

    if (isNaN(orderId) || isNaN(itemId)) {
      return response.error(res, 'معرف الطلب أو العنصر غير صحيح', 'INVALID_ID', 400);
    }
    if (!suggestedReplacementItemId) {
      return response.error(res, 'معرف الصنف البديل مطلوب', 'REPLACEMENT_REQUIRED', 400);
    }

    const result = await contractGateway.execute(orderId, 'SUGGEST_REPLACEMENT', {
      itemId,
      suggestedReplacementItemId: parseInt(suggestedReplacementItemId),
      idempotencyKey
    }, req.user);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('suggestReplacement error', { error: error.message });
    if (error.message === 'ORDER_NOT_FOUND') {
      return response.error(res, 'الطلب غير موجود', 'ORDER_NOT_FOUND', 404);
    }
    if (error.message === 'ORDER_ITEM_NOT_FOUND') {
      return response.error(res, 'العنصر المراد استبداله غير موجود', 'ITEM_NOT_FOUND', 404);
    }
    if (error.message === 'INVALID_ITEM_STATUS') {
      return response.error(res, 'حالة العنصر لا تسمح بالاستبدال', 'INVALID_STATUS', 400);
    }
    if (error.message === 'ALTERNATIVE_ITEM_NOT_FOUND') {
      return response.error(res, 'الصنف البديل المقترح غير موجود', 'ALTERNATIVE_NOT_FOUND', 404);
    }
    if (error.message === 'ALTERNATIVE_ITEM_UNAVAILABLE') {
      return response.error(res, 'الصنف البديل غير متوفر حالياً', 'ALTERNATIVE_UNAVAILABLE', 400);
    }
    if (error.message === 'UNAUTHORIZED_ORDER_ACCESS') {
      return response.error(res, 'غير مصرح لك بالوصول لهذا الطلب', 'FORBIDDEN', 403);
    }
    return response.error(res, 'فشل اقتراح صنف بديل', 'SERVER_ERROR', 500);
  }
};

exports.respondReplacement = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const itemId = parseInt(req.params.itemId);
    const { accept, preference } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || `respond_${orderId}_${itemId}_${Date.now()}`;

    if (isNaN(orderId) || isNaN(itemId)) {
      return response.error(res, 'معرف الطلب أو العنصر غير صحيح', 'INVALID_ID', 400);
    }
    if (accept === undefined) {
      return response.error(res, 'يجب تحديد القبول أو الرفض', 'ACCEPT_REQUIRED', 400);
    }

    const result = await contractGateway.execute(orderId, 'RESPOND_REPLACEMENT', {
      itemId,
      accept: !!accept,
      preference: preference || 'DEDUCT_FROM_BILL',
      idempotencyKey
    }, req.user);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('respondReplacement error', { error: error.message });
    if (error.message === 'ORDER_NOT_FOUND') {
      return response.error(res, 'الطلب غير موجود', 'ORDER_NOT_FOUND', 404);
    }
    if (error.message === 'ORDER_ITEM_NOT_FOUND') {
      return response.error(res, 'العنصر غير موجود', 'ITEM_NOT_FOUND', 404);
    }
    if (error.message === 'INVALID_ITEM_STATUS') {
      return response.error(res, 'لم يتم تقديم طلب استبدال لهذا العنصر أو انتهت صلاحيته', 'INVALID_STATUS', 400);
    }
    if (error.message === 'SUGGESTED_ITEM_NOT_FOUND') {
      return response.error(res, 'الصنف المقترح غير متوفر حالياً', 'ALTERNATIVE_UNAVAILABLE', 400);
    }
    if (error.message === 'CANNOT_CANCEL_ALL_ITEMS') {
      return response.error(res, 'لا يمكن إلغاء جميع عناصر الطلب', 'CANNOT_CANCEL_ALL', 400);
    }
    if (error.message === 'UNAUTHORIZED_ORDER_ACCESS') {
      return response.error(res, 'غير مصرح لك بالوصول لهذا الطلب', 'FORBIDDEN', 403);
    }
    return response.error(res, 'فشل الرد على مقترح الاستبدال', 'SERVER_ERROR', 500);
  }
};

exports.requestCoupon = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const itemId = parseInt(req.params.itemId);
    const idempotencyKey = req.headers['idempotency-key'] || `coupon_req_${orderId}_${itemId}_${Date.now()}`;

    if (isNaN(orderId) || isNaN(itemId)) {
      return response.error(res, 'معرف الطلب أو العنصر غير صحيح', 'INVALID_ID', 400);
    }

    const result = await contractGateway.execute(orderId, 'REQUEST_COUPON', {
      itemId,
      idempotencyKey
    }, req.user);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('requestCoupon error', { error: error.message });
    if (error.message === 'ORDER_NOT_FOUND') {
      return response.error(res, 'الطلب غير موجود', 'ORDER_NOT_FOUND', 404);
    }
    if (error.message === 'ORDER_ITEM_NOT_FOUND') {
      return response.error(res, 'العنصر غير موجود', 'ITEM_NOT_FOUND', 404);
    }
    if (error.message === 'ITEM_NOT_CANCELLED') {
      return response.error(res, 'العنصر ليس ملغياً ولا يمكن طلب كوبون له', 'ITEM_NOT_CANCELLED', 400);
    }
    if (error.message === 'COUPON_REQUEST_ALREADY_EXISTS') {
      return response.error(res, 'تم تقديم طلب كوبون خصم مسبقاً لهذا العنصر', 'COUPON_ALREADY_REQUESTED', 400);
    }
    if (error.message === 'UNAUTHORIZED_ORDER_ACCESS') {
      return response.error(res, 'غير مصرح لك بالوصول لهذا الطلب', 'FORBIDDEN', 403);
    }
    return response.error(res, 'فشل طلب كوبون الخصم', 'SERVER_ERROR', 500);
  }
};

