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
const { parsePagination } = require('../utils/pagination');

/**
 * 🥡 Order Controller (Performance Optimized)
 */

/**
 * Fetch authenticated customer orders
 */
exports.getMyOrders = async (req, res) => {
  try {
    const userUuid = req.user.id;
    const { page, limit, skip } = parsePagination(req.query);

    const customer = await prisma.customer.findUnique({ 
      where: { uuid: userUuid },
      select: { id: true } 
    });
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
      success: true,
      data: orders.map(mapOrderResponse),
      pagination: { total, page, limit, pages: Math.ceil(total / limit), hasMore: (page * limit) < total }
    });
  } catch (error) {
    logger.error('Fetch my orders error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

/**
 * Admin: Filtered Order Fetch (With Search & Status Aggregation)
 */
exports.getOrders = async (req, res) => {
  try {
    const { status, search, active_only } = req.query;
    const { page: pageNum, limit: limitNum, skip } = parsePagination(req.query);

    const where = {};
    if (active_only === 'true') {
      where.status = { notIn: ['delivered', 'cancelled'] };
    } else if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerPhone: { contains: search } }
      ];
    }

    const [orders, total, statusCounts] = await Promise.all([
      prisma.order.findMany({
        where,
        include: ORDER_INCLUDE_FULL,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.order.count({ where }),
      prisma.order.groupBy({
        by: ['status'],
        _count: { id: true }
      })
    ]);

    res.json({
      success: true,
      data: orders.map(mapOrderResponse),
      pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
      statusSummary: statusCounts.reduce((acc, s) => {
        acc[s.status] = s._count.id;
        return acc;
      }, {})
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
    const { startDate, endDate, status, page, limit } = req.query;
    const where = {};

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate + 'T00:00:00.000Z');
      if (endDate)   where.createdAt.lte = new Date(endDate + 'T23:59:59.999Z');
    }
    if (status) where.status = status;

    // Use pagination if provided, else return first 500 records to prevent crash
    const pageNum = page ? Math.max(1, parseInt(page)) : null;
    const limitNum = limit ? Math.min(1000, parseInt(limit)) : 500;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: ORDER_INCLUDE_FULL,
        orderBy: { createdAt: 'desc' },
        ...(pageNum ? { skip: (pageNum - 1) * limitNum, take: limitNum } : { take: limitNum })
      }),
      prisma.order.count({ where })
    ]);

    res.json({
      success: true,
      data: orders.map(mapOrderResponse),
      pagination: pageNum ? { total, page: pageNum, limit: limitNum } : { total, limit: limitNum }
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

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
          ...ORDER_INCLUDE_FULL,
          // Add extra details for single view if needed
          auditLogs: { orderBy: { createdAt: 'desc' }, take: 10 }
      }
    });

    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });

    // 🛡️ Security: Enforce ownership for customers
    if (req.user.role === 'customer') {
        const customer = await prisma.customer.findUnique({
            where: { uuid: req.user.id },
            select: { id: true }
        });
        if (!customer || order.customerId !== customer.id) {
            return res.status(404).json({ error: 'الطلب غير موجود' });
        }
    }

    res.json({
      success: true,
      data: mapOrderResponse(order)
    });
  } catch (error) {
    logger.error('Fetch order by ID error', { error: error.message, orderId: req.params.id });
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
     const { status } = req.body;
     if (isNaN(orderId)) return res.status(400).json({ error: 'ID مطلوب' });
     
     const result = await exports.performStatusUpdate(orderId, status);
     if (!result) return res.status(400).json({ error: 'فشل تحديث الحالة' });
     res.json(result);
   } catch (error) {
     res.status(500).json({ error: 'Status update failed' });
   }
};

/**
 * ⏲️ Update estimated ready time (Admin)
 */
exports.updateOrderTimer = async (req, res) => {
  try {
    const { estimatedReadyAt } = req.body;
    const date = new Date(estimatedReadyAt);
    if (isNaN(date.getTime())) {
      return res.status(400).json({ error: 'تاريخ غير صالح' });
    }
    const order = await prisma.order.update({
      where: { id: parseInt(req.params.id) },
      data: { estimatedReadyAt: date },
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
    const orderId = parseInt(req.params.id);

    if (!rating || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'التقييم يجب أن يكون رقماً بين 1 و 5' });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });
    
    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
    
    if (req.user?.role !== 'admin' && order.customer?.uuid !== req.user?.id) {
      return res.status(403).json({ error: 'غير مصرح لك بتقييم هذا الطلب' });
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: { rating, ratingComment: comment, isRatingApproved: false },
      include: ORDER_INCLUDE_FULL
    });
    res.json(mapOrderResponse(updatedOrder));
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit rating' });
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { reason } = req.body;
    
    if (reason && reason.length > 500) {
      return res.status(400).json({ error: 'سبب الإلغاء يتجاوز الحد المسموح (500 حرف)' });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const isOrderManager = req.user?.role === 'admin';
    const canCancelDirectly = isOrderManager || order.status === 'pending';
    
    let targetStatus = 'cancelled';
    let cancellationStatus = 'approved';

    if (!canCancelDirectly) {
      targetStatus = 'waiting_cancellation';
      cancellationStatus = 'pending';
    }

    const previousStatus = order.status;

    const [updatedOrder] = await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId, version: order.version },
        data: { status: targetStatus, version: { increment: 1 } },
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
    
    // Background tasks (Analytics, EventBus)
    analyticsService.updateCacheIncrementally({
      type: 'ORDER_STATUS_CHANGE',
      amount: toNumber(updatedOrder.total),
      status: targetStatus,
      previousStatus
    });

    await publishEvent({
      type: targetStatus === 'cancelled' ? eventTypes.ORDER_CANCELLED : eventTypes.ORDER_CANCELLATION_REQUESTED,
      aggregateId: updatedOrder.id,
      payload: { previousStatus, newStatus: targetStatus, order: mapped },
      version: updatedOrder.version
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

/**
 * Partial Cancellation Handlers
 */
exports.requestPartialCancel = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { items, reason } = req.body;

    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
      include: { customer: true }
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });

    await prisma.notification.create({
      data: {
        title: 'طلب إلغاء جزئي ⚠️',
        message: `طلب تعديل للطلب #${order.orderNumber} من ${order.customerName}`,
        type: 'partial_cancel_requested',
        orderId: order.id,
        targetRoute: `/orders?id=${order.id}`
      }
    });

    res.json({ success: true, message: 'تم إرسال طلب التعديل للإدارة' });
  } catch (error) {
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
 * ⚡ Atomic Status Update Helper
 */
exports.performStatusUpdate = async (orderId, newStatus) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });

    if (!order || order.status === newStatus) return null;

    const previousStatus = order.status;

    // Validate state machine sequence
    const validTransitions = {
      'pending': ['preparing', 'cancelled'],
      'preparing': ['ready', 'cancelled'],
      'ready': ['in_route', 'delivered', 'cancelled'],
      'in_route': ['delivered', 'cancelled'],
      'waiting_cancellation': ['cancelled', 'pending', 'preparing', 'ready', 'in_route', 'delivered'],
      'delivered': [],
      'cancelled': []
    };

    if (!validTransitions[previousStatus]?.includes(newStatus)) {
      throw new Error(`Invalid status transition from ${previousStatus} to ${newStatus}`);
    }

    const updatedOrder = await prisma.order.update({
      where: { id: order.id, version: order.version },
      data: { status: newStatus, version: { increment: 1 } },
      include: ORDER_INCLUDE_FULL
    });

    const mappedOrder = mapOrderResponse(updatedOrder);

    // Pub/Sub
    await publishEvent({
      type: eventTypes.ORDER_STATUS_CHANGED,
      aggregateId: updatedOrder.id,
      payload: { previousStatus, newStatus, order: mappedOrder },
      version: updatedOrder.version
    });

    return mappedOrder;
  } catch (error) {
    logger.error('performStatusUpdate failed', { orderId, newStatus, error: error.message });
    return null;
  }
};

exports.getCustomerOrders = exports.getOrders;
