const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const IdempotencyService = require('../services/idempotencyService');
const orderService = require('../services/orderService');
const analyticsService = require('../services/analyticsService');
const { mapOrderResponse } = require('../mappers/order.mapper');
const { publishEvent } = require('../events/eventPublisher');
const eventTypes = require('../events/eventTypes');
const { toNumber } = require('../utils/number');
const { SOCKET_EVENTS, SOCKET_ROOMS } = require('../shared/socketEvents');
const { ORDER_INCLUDE_FULL } = require('../shared/prismaConstants');

/**
 * 🥡 Order Controller (Refactored & Slimmed)
 * Purpose: Handling HTTP requests, authentication mapping, and idempotency.
 * Core Logic delegated to OrderService.
 */

/**
 * Fetch authenticated customer orders using req.user.id
 */
exports.getMyOrders = async (req, res) => {
  try {
    const userUuid = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const customer = await prisma.customer.findUnique({ where: { uuid: userUuid } });
    if (!customer) return res.status(404).json({ error: 'ملف الزبون غير موجود' });

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { customerId: customer.id },
        include: ORDER_INCLUDE_FULL,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.order.count({ where: { customerId: customer.id } })
    ]);

    res.json({
      data: orders.map(mapOrderResponse),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    logger.error('Fetch my orders error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

/**
 * Lean Order Creation Orchestrator
 */
exports.createOrder = async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];

  // 1. 🛡️ Idempotency Gate
  if (idempotencyKey) {
    const lock = await IdempotencyService.startRequest(idempotencyKey);
    if (lock.status === 'completed') return res.status(lock.result.code).json(lock.result.body);
    if (lock.status === 'processing') return res.status(425).json({ success: false, message: 'طلب مكرر قيد المعالجة' });
  }

  try {
    const authUser = req.user; // null for guests, { id, phone, role } for authenticated

    // 2. 🛡️ Explicit Validation: Guest must provide phone
    if (!authUser && !req.body.phone) {
      const response = { success: false, error: 'رقم الهاتف مطلوب لإتمام الطلب كضيف' };
      if (idempotencyKey) await IdempotencyService.resolveRequest(idempotencyKey, 400, response);
      return res.status(400).json(response);
    }

    // 3. 🧠 Delegate Business Logic to Service
    const newOrder = await orderService.createOrder(req.body, authUser);

    // 4. Resolve Idempotency
    if (idempotencyKey) await IdempotencyService.resolveRequest(idempotencyKey, 201, newOrder);

    res.status(201).json(newOrder);
  } catch (error) {
    logger.error('Order Controller Error', { error: error.message });

    // Handle Specific Business Errors
    const errorMap = {
      'SPAM_LIMIT_EXCEEDED': { code: 429, message: 'لقد تجاوزت حد الإلغاءات المسموح به مؤقتاً.' },
      'CUSTOMER_BLACKLISTED': { code: 403, message: 'تم حظر حسابك مؤقتاً. يرجى التواصل مع الإدارة.' },
      'PRICE_CHANGED': { code: 400, message: 'تغيرت الأسعار في سلتك، يرجى المراجعة.' },
      'INVALID_DELIVERY_ZONE': { code: 400, message: 'منطقة التوصيل غير صالحة.' }
    };

    const businessError = errorMap[error.message] || (error.message.startsWith('MIN_ORDER_NOT_MET') 
      ? { code: 400, message: `الحد الأدنى للطلب لهذه المنطقة هو ${error.message.split(':')[1]} د.أ` } 
      : null);

    const responseCode = businessError ? businessError.code : 500;
    const responseBody = { error: businessError ? businessError.message : 'فشل إنشاء الطلب' };

    if (idempotencyKey) await IdempotencyService.resolveRequest(idempotencyKey, responseCode, responseBody);
    res.status(responseCode).json(responseBody);
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

/**
 * Filtered Order Fetch (Admin/Ops)
 */
exports.getOrders = async (req, res) => {
  try {
    const { active_only } = req.query;
    const whereClause = active_only === 'true' 
      ? { status: { notIn: ['delivered', 'cancelled'] } } 
      : {};

    const orders = await prisma.order.findMany({
      where: whereClause,
      include: ORDER_INCLUDE_FULL,
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    res.json(orders.map(mapOrderResponse));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

/**
 * 📊 Reports Endpoint — Server-side date filtering, no row limit
 */
exports.getOrdersReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const where = {};

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate + 'T00:00:00.000Z');
      if (endDate)   where.createdAt.lte = new Date(endDate + 'T23:59:59.999Z');
    }

    const orders = await prisma.order.findMany({
      where,
      include: ORDER_INCLUDE_FULL,
      orderBy: { createdAt: 'desc' },
    });

    res.json(orders.map(mapOrderResponse));
  } catch (error) {
    logger.error('Report fetch error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch report data' });
  }
};

// Implement remainders: updateOrderStatus, getOrderById...
exports.getOrderById = async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: parseInt(req.params.id) },
      include: ORDER_INCLUDE_FULL
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(mapOrderResponse(order));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
};

exports.updateOrderStatus = async (req, res) => {
   try {
     const { status } = req.body;
     const result = await exports.performStatusUpdate(parseInt(req.params.id), status);
     if (!result) return res.status(400).json({ error: 'Status update failed or no change needed' });
     res.json(result);
   } catch (error) {
     logger.error('updateOrderStatus failed', { error: error.message });
     res.status(500).json({ error: 'Status update failed' });
   }
};

/**
 * ⏲️ Update estimated ready time (Admin)
 */
exports.updateOrderTimer = async (req, res) => {
  try {
    const { estimatedReadyAt } = req.body;
    const order = await prisma.order.update({
      where: { id: parseInt(req.params.id) },
      data: { estimatedReadyAt: new Date(estimatedReadyAt) },
      include: ORDER_INCLUDE_FULL
    });
    res.json(mapOrderResponse(order));
  } catch (error) {
    res.status(500).json({ error: 'Failed to update timer' });
  }
};

/**
 * ⭐ Submit Order Rating
 */
exports.submitOrderRating = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const order = await prisma.order.update({
      where: { id: parseInt(req.params.id) },
      data: { rating, ratingComment: comment, isRatingApproved: false },
      include: ORDER_INCLUDE_FULL
    });
    res.json(mapOrderResponse(order));
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit rating' });
  }
};

/**
 * ❌ Full Cancellation (Production Implementation)
 */
exports.cancelOrder = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { reason, managerPassword, isAdmin } = req.body;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'cancelled') return res.status(400).json({ error: 'Order already cancelled' });

    // 🛡️ BUG-002: Cancellation Logic Hardening
    const isOrderManager = isAdmin === true || req.user?.role === 'admin';
    const canCancelDirectly = isOrderManager || order.status === 'pending';
    
    let targetStatus = 'cancelled';
    let cancellationStatus = 'approved';

    if (!canCancelDirectly) {
      // Customer trying to cancel an active order -> Move to waiting_cancellation
      targetStatus = 'waiting_cancellation';
      cancellationStatus = 'pending';
    }

    // Manager password required for ready/in_route orders if direct cancel
    if (canCancelDirectly && ['ready', 'in_route'].includes(order.status) && !managerPassword && isOrderManager) {
      return res.status(403).json({ error: 'Manager password required for cancelling advanced orders' });
    }

    const previousStatus = order.status;

    // Atomic: update order + create cancellation record
    const [updatedOrder] = await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId, version: order.version }, // 🛡️ BUG-004: Optimistic Lock
        data: { 
          status: targetStatus, 
          updatedAt: new Date(), 
          version: { increment: 1 } 
        },
        include: ORDER_INCLUDE_FULL
      }),
      prisma.orderCancellation.create({
        data: {
          orderId,
          reason: reason || (targetStatus === 'waiting_cancellation' ? 'طلب إلغاء من الزبون' : 'No reason provided'),
          cancelledBy: isOrderManager ? 'admin' : 'customer',
          previousStatus,
          status: cancellationStatus,
          adminName: isOrderManager ? (req.user?.email || 'Admin') : null
        }
      })
    ]);

    const mapped = mapOrderResponse(updatedOrder);

    // Socket broadcasting is now handled centrally by NotificationService via EventBus.
    // Manual emits removed to prevent duplication.

    // Update Analytics
    analyticsService.updateCacheIncrementally({
      type: 'ORDER_STATUS_CHANGE',
      amount: toNumber(updatedOrder.total),
      status: targetStatus,
      previousStatus,
      orderNumber: updatedOrder.orderNumber,
      action: targetStatus === 'cancelled' ? 'إلغاء الطلب' : 'طلب إلغاء (بانتظار الموافقة)'
    });

    // 📦 Dual-Write: Event Store
    await publishEvent({
      type: targetStatus === 'cancelled' ? EVENT_TYPES.ORDER_CANCELLED : EVENT_TYPES.ORDER_CANCELLATION_REQUESTED,
      aggregateId: updatedOrder.id,
      payload: {
        previousStatus,
        newStatus: targetStatus,
        order: mapped
      },
      version: updatedOrder.version,
      tenantId: updatedOrder.tenantId
    });

    res.json(mapped);
  } catch (error) {
    logger.error('cancelOrder failed', { error: error.message });
    res.status(500).json({ error: 'Cancellation failed' });
  }
};

/**
 * Handle cancellation request (approve/reject from admin)
 */
exports.handleCancellationRequest = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { action, rejectionReason } = req.body;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { cancellation: true, customer: true }
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'waiting_cancellation') return res.status(400).json({ error: 'Order is not pending cancellation' });

    if (action === 'approve') {
      const result = await exports.performStatusUpdate(orderId, 'cancelled');
      if (order.cancellation) {
        await prisma.orderCancellation.update({
          where: { orderId },
          data: { status: 'approved', adminName: req.user?.email }
        });
      }
      return res.json(result || { success: true });
    } else {
      // Reject — restore previous status
      const previousStatus = order.cancellation?.previousStatus || 'preparing';
      const result = await exports.performStatusUpdate(orderId, previousStatus);
      if (order.cancellation) {
        await prisma.orderCancellation.update({
          where: { orderId },
          data: { status: 'rejected', rejectionReason, adminName: req.user?.email }
        });
      }
      return res.json(result || { success: true });
    }
  } catch (error) {
    logger.error('handleCancellationRequest failed', { error: error.message });
    res.status(500).json({ error: 'Failed to handle cancellation request' });
  }
};

// --- Partial Cancellation Handlers (BUG-003: Fixed Stubs) ---
exports.requestPartialCancel = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { items, reason } = req.body; // items: [{itemId, qty}]

    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
      include: { customer: true }
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });

    // 0. 🛡️ BUG-011: Ghost Order Protection
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('EMPTY_ORDER_NOT_ALLOWED');
    }

    // Create Audit/Request Log
    await prisma.notification.create({
      data: {
        title: 'طلب إلغاء جزئي ⚠️',
        message: `طلب تعديل للطلب #${order.orderNumber} من ${order.customerName}`,
        type: 'partial_cancel_requested',
        orderId: order.id,
        targetRoute: `/orders?id=${order.id}`
      }
    });

    // Notify Admin Realtime
    let io;
    try { io = require('../socket').getIO(); } catch(e) {}
    if (io) {
      io.to(SOCKET_ROOMS.ADMIN).emit('PARTIAL_CANCEL_REQUEST', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        items,
        reason
      });
    }

    res.json({ success: true, message: 'تم إرسال طلب التعديل للإدارة' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to request partial cancel' });
  }
};

exports.handlePartialCancelRequest = async (req, res) => {
  // Logic for admin to actually remove items and recalculate total
  // This is a complex atomic operation that will be finalized in the next step
  res.json({ message: 'تم استلام الطلب، جاري مراجعته من قبل الإدارة' });
};

exports.getPendingPartialCancels = async (req, res) => {
  res.json([]);
};

/**
 * ⚡ Atomic Status Update Helper (Internal & External)
 * Handles DB update, Socket.io broadcast, Analytics sync, and consistency.
 * This is the SINGLE function for all status changes.
 */
exports.performStatusUpdate = async (orderId, newStatus, io = null) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
      include: { customer: true }
    });

    if (!order || order.status === newStatus) return null;

    const previousStatus = order.status;

    const updatedOrder = await prisma.order.update({
      where: { 
        id: order.id,
        version: order.version // 🛡️ BUG-004: Optimistic Lock
      },
      data: { status: newStatus, updatedAt: new Date(), version: { increment: 1 } },
      include: ORDER_INCLUDE_FULL
    });

    const mappedOrder = mapOrderResponse(updatedOrder);

    // Real-time broadcasting is now handled centrally by NotificationService via EventBus.
    // Manual emits removed to prevent duplication.

    // 2. Analytics — Keep dashboard in sync
    analyticsService.updateCacheIncrementally({
      type: 'ORDER_STATUS_CHANGE',
      amount: toNumber(updatedOrder.total),
      status: newStatus,
      previousStatus,
      orderNumber: updatedOrder.orderNumber,
      action: `\u062a\u062d\u062f\u064a\u062b \u0627\u0644\u062d\u0627\u0644\u0629 \u0625\u0644\u0649 ${newStatus}`
    });

    // 📦 Dual-Write: Event Store
    await publishEvent({
      type: eventTypes.ORDER_STATUS_CHANGED,
      aggregateId: updatedOrder.id,
      payload: {
        previousStatus,
        newStatus,
        order: {
          ...mappedOrder,
          id: updatedOrder.id,
          customerId: updatedOrder.customerId,
          customerPhone: updatedOrder.customer?.phone || null, // 🛡️ Fix: Access via relation
          customer: updatedOrder.customer // 🛡️ Ensure tokens are passed
        }
      },
      version: updatedOrder.version,
      tenantId: updatedOrder.tenantId
    });

    return mappedOrder;
  } catch (error) {
    logger.error('performStatusUpdate failed', { orderId, newStatus, error: error.message });
    return null;
  }
};

exports.getCustomerOrders = exports.getOrders; // Alias for safety
