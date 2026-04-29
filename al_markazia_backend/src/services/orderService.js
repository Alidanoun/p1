/**
 * 🥡 Order Core Service (Refactored)
 * Purpose: Centralized business logic for all order-related operations.
 * Features: Atomic transactions, multi-factor validation, and idempotency support.
 */
const prisma = require('../lib/prisma');
const redis = require('../lib/redis');
const xss = require('xss');
const logger = require('../utils/logger');
const AuditLogger = require('../utils/auditLogger');
const analyticsService = require('./analyticsService');
const loyaltyService = require('./loyaltyService');
const { orderQueue } = require('../queues/orderQueue');
const memoryCache = require('../lib/memoryCache');
const { publishEvent } = require('../events/eventPublisher');
const eventTypes = require('../events/eventTypes');
const { toNumber, toMoney } = require('../utils/number');
const { mapOrderResponse } = require('../mappers/order.mapper');
const { ORDER_INCLUDE_FULL } = require('../shared/prismaConstants');

class OrderService {
  /**
   * 📊 Admin: Reports Data Fetching
   */
  async getOrdersReport(query) {
    const { startDate, endDate, status, page, limit } = query;
    const where = {};

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate + 'T00:00:00.000Z');
      if (endDate)   where.createdAt.lte = new Date(endDate + 'T23:59:59.999Z');
    }
    if (status) where.status = status;

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

    return {
      orders: orders.map(mapOrderResponse),
      total,
      page: pageNum,
      limit: limitNum
    };
  }

  /**
   * 🔍 Advanced Order Query (Admin)
   */
  async getOrders(query) {
    const { status, search, active_only } = query;
    const { page, limit, skip } = require('../utils/pagination').parsePagination(query);

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
        take: limit
      }),
      prisma.order.count({ where }),
      prisma.order.groupBy({
        by: ['status'],
        _count: { id: true }
      })
    ]);

    return {
      orders: orders.map(mapOrderResponse),
      total,
      page,
      limit,
      statusSummary: statusCounts.reduce((acc, s) => {
        acc[s.status] = s._count.id;
        return acc;
      }, {})
    };
  }

  /**
   * 👤 Fetch Customer-Specific Orders
   */
  async getCustomerOrders(userUuid, query) {
    const { status, active_only } = query;
    const { page, limit, skip } = require('../utils/pagination').parsePagination(query);

    const customer = await prisma.customer.findUnique({ 
      where: { uuid: userUuid },
      select: { id: true } 
    });
    if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

    const where = { customerId: customer.id };
    
    // 🔍 Apply Filters (Fix for "Current Orders" not appearing)
    if (active_only === 'true') {
      where.status = { notIn: ['delivered', 'cancelled'] };
    } else if (status) {
      where.status = status;
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: ORDER_INCLUDE_FULL,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.order.count({ where })
    ]);

    return {
      orders: orders.map(mapOrderResponse),
      total,
      page,
      limit
    };
  }

  /**
   * ⚠️ Request Partial Cancellation/Modification
   */
  async requestPartialCancel(orderId, items, reason) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });

    if (!order) throw new Error('ORDER_NOT_FOUND');

    await prisma.notification.create({
      data: {
        title: 'طلب إلغاء جزئي ⚠️',
        message: `طلب تعديل للطلب #${order.orderNumber} من ${order.customerName}`,
        type: 'partial_cancel_requested',
        orderId: order.id,
        targetRoute: `/orders?id=${order.id}`
      }
    });

    return { success: true };
  }

  /**
   * ⏲️ Update estimated ready time
   */
  async updateOrderTimer(orderId, estimatedReadyAt) {
    const date = new Date(estimatedReadyAt);
    if (isNaN(date.getTime())) throw new Error('INVALID_DATE');

    const order = await prisma.order.update({
      where: { id: orderId },
      data: { estimatedReadyAt: date },
      include: ORDER_INCLUDE_FULL
    });

    return mapOrderResponse(order);
  }

  /**
   * 👩‍🍳 Update Preparation Time (Minutes)
   */
  async updatePreparationTime(orderId, minutes) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error('ORDER_NOT_FOUND');

    const prepMinutes = parseInt(minutes);
    const delMinutes = order.deliveryTimeMinutes || 15;

    const newReadyAt = new Date(order.createdAt.getTime() + prepMinutes * 60000);
    const newArrivalAt = new Date(order.createdAt.getTime() + (prepMinutes + delMinutes) * 60000);

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        preparationTimeMinutes: prepMinutes,
        estimatedReadyAt: newReadyAt,
        estimatedArrivalAt: newArrivalAt
      },
      include: ORDER_INCLUDE_FULL
    });

    const mapped = mapOrderResponse(updated);

    // Notify Customer
    await publishEvent({
      type: eventTypes.ORDER_STATUS_CHANGED,
      aggregateId: orderId,
      payload: { 
        order: mapped, 
        newStatus: order.status, 
        notification: {
          title: 'تحديث وقت التجهيز ⏳',
          message: `تم تحديث وقت التجهيز المتوقع لطلبك #${order.orderNumber}. سيبدأ التوصيل قريباً.`
        }
      },
      version: updated.version
    });

    return mapped;
  }

  /**
   * ⭐ Submit Order Rating
   */
  async submitOrderRating(orderId, user, rating, comment) {
    if (!rating || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('INVALID_RATING');
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });
    
    if (!order) throw new Error('ORDER_NOT_FOUND');
    
    if (user?.role !== 'admin' && order.customer?.uuid !== user?.id) {
      throw new Error('ORDER_FORBIDDEN');
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: { rating, ratingComment: comment, isRatingApproved: false },
      include: ORDER_INCLUDE_FULL
    });

    return mapOrderResponse(updatedOrder);
  }

  /**
   * 🛠️ Manage Cancellation Requests (Approve/Reject)
   */
  async handleCancellationRequest(orderId, user, action, rejectionReason) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { cancellation: true, customer: true }
    });

    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.status !== 'waiting_cancellation') throw new Error('NOT_PENDING_CANCELLATION');

    if (action === 'approve') {
      const result = await this.updateOrderStatus(orderId, 'cancelled');
      if (order.cancellation) {
        await prisma.orderCancellation.update({
          where: { orderId },
          data: { status: 'approved', adminName: user?.email }
        });
      }
      return result;
    } else {
      // Reject — restore previous status
      const previousStatus = order.cancellation?.previousStatus || 'preparing';
      const result = await this.updateOrderStatus(orderId, previousStatus);
      if (order.cancellation) {
        await prisma.orderCancellation.update({
          where: { orderId },
          data: { status: 'rejected', rejectionReason, adminName: user?.email }
        });
      }
      return result;
    }
  }

  /**
   * 🎯 Fetch Unique Order with Details
   */
  async getOrderById(orderId, user = null) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        ...ORDER_INCLUDE_FULL,
        auditLogs: { orderBy: { createdAt: 'desc' }, take: 10 }
      }
    });

    if (!order) return null;

    // 🛡️ Security Guard
    if (user && user.role === 'customer') {
      const customer = await prisma.customer.findUnique({ where: { uuid: user.id }, select: { id: true } });
      if (!customer || order.customerId !== customer.id) {
        throw new Error('ORDER_FORBIDDEN');
      }
    }

    return mapOrderResponse(order);
  }

  /**
   * 🛑 Cancel Order with Multi-tier Validation
   */
  async cancelOrder(orderId, user, reason) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });

    if (!order) throw new Error('ORDER_NOT_FOUND');

    const isOrderManager = user?.role === 'admin';
    const canCancelDirectly = isOrderManager || order.status === 'pending';
    
    const targetStatus = canCancelDirectly ? 'cancelled' : 'waiting_cancellation';
    const cancellationStatus = canCancelDirectly ? 'approved' : 'pending';
    const previousStatus = order.status;

    const updatedOrder = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId, version: order.version },
        data: { status: targetStatus, version: { increment: 1 } },
        include: ORDER_INCLUDE_FULL
      });

      await tx.orderCancellation.create({
        data: {
          orderId,
          reason: reason || (targetStatus === 'waiting_cancellation' ? 'طلب إلغاء من الزبون' : 'No reason provided'),
          cancelledBy: isOrderManager ? 'admin' : 'customer',
          previousStatus,
          status: cancellationStatus,
          adminName: isOrderManager ? (user?.email || 'Admin') : null
        }
      });

      return updated;
    });

    const mapped = mapOrderResponse(updatedOrder);

    // 🚀 Side Effects
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

    return mapped;
  }

  /**
   * 🏗️ Enterprise Order Creation
   * Full transactional logic moved from Controller.
   */
  async createOrder(data, authUser = null) {
    const { 
      customerName, 
      customerPhone, 
      orderType, 
      paymentMethod, 
      address, 
      notes, 
      cartItems, 
      branch,
      deliveryZoneId
    } = data;

    // 0. 🛡️ BUG-011: Ghost Order Protection
    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      throw new Error('EMPTY_ORDER_NOT_ALLOWED');
    }

    const phoneInput = data.phone || customerPhone;

    // 1. 🆔 Identity & Blacklist Resolution
    const resolvedCustomer = await this._resolveAndValidateCustomer(phoneInput, authUser);

    // 2. 🛡️ Spam Protection (Multi-factor)
    await this._validateSpamLimits(resolvedCustomer.phone);

    // 3. 💰 Pricing & Inventory Validation
    const { validatedItems, subtotal } = await this._calculateAndValidatePricing(cartItems);

    // 4. 🚚 Delivery & Region Validation
    const deliveryDetails = await this._validateDeliveryDetails(orderType, deliveryZoneId, subtotal);

    // 5. 🔢 Generate Atomic Order Number
    const orderNumber = await this._generateOrderNumber();

    // 🛡️ Pricing Logic: Inclusive of Tax
    const tax = 0; 
    const total = toMoney(subtotal + deliveryDetails.fee);

    // 6. 💎 Atomic Transactional Persistence
    const { newOrder } = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNumber,
          customerName: customerName || 'زبون',
          customerPhone: resolvedCustomer.phone,
          customerId: resolvedCustomer.id,
          orderType: orderType || 'takeaway',
          paymentMethod: paymentMethod || 'cash',
          subtotal,
          tax,
          deliveryFee: deliveryDetails.fee,
          total,
          status: 'pending',
          source: (authUser && authUser.role === 'admin') ? 'manual' : 'app',
          address: address ? xss(address) : address,
          notes: notes ? xss(notes) : notes,
          branch,
          deliveryZoneId: deliveryDetails.zoneId,
          deliveryZoneName: deliveryDetails.zoneName,
          deliveryMinOrder: deliveryDetails.minOrder,
          preparationTimeMinutes: 20, // Default
          deliveryTimeMinutes: 15,    // Default
          estimatedReadyAt: new Date(Date.now() + 20 * 60000),
          estimatedArrivalAt: new Date(Date.now() + (20 + 15) * 60000),
          orderItems: {
            create: validatedItems
          }
        },
        include: ORDER_INCLUDE_FULL
      });

      // Admin Internal Notification
      await tx.notification.create({
        data: {
          title: 'طلب جديد 🔔',
          titleEn: 'New Order 🔔',
          message: `طلب جديد (${order.orderNumber}) من ${order.customerName} بقيمة ${toNumber(order.total)} د.أ`,
          messageEn: `New order (${order.orderNumber}) from ${order.customerName} - ${toNumber(order.total)} JD`,
          type: 'order_created',
          orderId: order.id,
          targetRoute: '/orders'
        }
      });

      return { newOrder: order };
    });

    // 7. 🚀 Async Side Effects (Non-blocking)
    this._triggerPostOrderEffects(newOrder);

    const mappedOrder = mapOrderResponse(newOrder);

    // 📦 Dual-Write: Publish Event to Store
    await publishEvent({
      type: eventTypes.ORDER_CREATED,
      aggregateId: mappedOrder.id,
      payload: {
        ...mappedOrder,
        id: newOrder.id,
        customerId: newOrder.customerId,
        customerPhone: newOrder.customer?.phone || null,
        customer: newOrder.customer
      },
      version: 1,
      tenantId: mappedOrder.tenantId
    });

    return mappedOrder;
  }

  /**
   * 🛡️ Spam Guard: Checks recent cancellations and blacklists if necessary.
   */
  async _validateSpamLimits(phone) {
    // 🛡️ 3-Tier Fallback for Settings
    let settings = memoryCache.get('system:settings');
    
    if (!settings) {
      const redisSettings = await redis.get('system:settings');
      if (redisSettings) {
        settings = JSON.parse(redisSettings);
        memoryCache.set('system:settings', settings, 300); // 5 mins
      } else {
        settings = await prisma.systemSettings.findFirst();
        if (settings) {
          await redis.set('system:settings', JSON.stringify(settings), 'EX', 3600);
          memoryCache.set('system:settings', settings, 300);
        }
      }
    }

    const limit = settings?.spamCancelLimit ?? 3;
    const window = settings?.spamTimeWindowMinutes ?? 30;
    const since = new Date(Date.now() - window * 60 * 1000);

    const count = await prisma.orderCancellation.count({
      where: {
        order: { customerPhone: phone },
        createdAt: { gte: since },
      },
    });

    if (count >= limit) {
      const expires = new Date(Date.now() + window * 60 * 1000);
      await prisma.customer.update({
        where: { phone },
        data: { 
          isBlacklisted: true,
          blacklistExpiresAt: expires,
          blacklistReason: `Spam detected: ${count} cancellations in ${window}m`,
          blacklistType: 'auto'
        }
      });
      throw new Error('SPAM_LIMIT_EXCEEDED');
    }
  }

  /**
   * 🆔 Resolve customer and check blacklist status.
   */
  async _resolveAndValidateCustomer(phone, authUser) {
    let resolvedPhone = phone;
    let customer = null;

    if (authUser) {
      customer = await prisma.customer.findUnique({ where: { uuid: authUser.id } });
      if (customer) resolvedPhone = customer.phone;
    }

    if (!customer) {
      customer = await prisma.customer.findUnique({ where: { phone: resolvedPhone } });
    }

    if (customer?.isBlacklisted) {
      if (customer.blacklistExpiresAt && customer.blacklistExpiresAt < new Date()) {
        customer = await prisma.customer.update({
          where: { id: customer.id },
          data: { isBlacklisted: false, blacklistExpiresAt: null }
        });
      } else {
        throw new Error('CUSTOMER_BLACKLISTED');
      }
    }

    return { 
      id: customer?.id || null, 
      phone: resolvedPhone 
    };
  }

  /**
   * 💰 Calculation Engine: Re-verifies all prices from DB to prevent client-side manipulation.
   */
  async _calculateAndValidatePricing(cartItems) {
    let subtotal = 0;
    const validatedItems = [];

    for (const item of cartItems) {
      const dbItem = await prisma.item.findUnique({ 
        where: { id: parseInt(item.productId || item.id) },
        include: { optionGroups: { include: { options: true } } }
      });

      if (!dbItem) throw new Error(`ITEM_NOT_FOUND:${item.id}`);

      let unitPrice = toNumber(dbItem.basePrice);
      const optionIds = item.optionIds || [];

      if (optionIds.length > 0) {
        const dbOptions = await prisma.itemOption.findMany({
          where: { id: { in: optionIds.map(id => parseInt(id)) } },
          include: { group: true }
        });

        for (const opt of dbOptions) {
          if (opt.group.itemId !== dbItem.id) throw new Error('DATA_INTEGRITY_VIOLATION');
          unitPrice += toNumber(opt.price);
        }
      }

      const qty = parseInt(item.quantity || 1);
      const lineTotal = toMoney(unitPrice * qty);
      subtotal += lineTotal;

      validatedItems.push({
        itemId: dbItem.id,
        itemName: dbItem.title,
        itemNameEn: dbItem.titleEn || dbItem.title,
        quantity: qty,
        unitPrice,
        lineTotal,
        selectedOptions: item.optionsText || null,
        selectedOptionsEn: item.optionsTextEn || null
      });
    }

    return { validatedItems, subtotal };
  }

  /**
   * 🚚 Delivery Logic: Ensures fee and min-order constraints are met.
   */
  async _validateDeliveryDetails(type, zoneId, subtotal) {
    if (type !== 'delivery') return { fee: 0, zoneId: null, zoneName: null, minOrder: 0 };

    if (!zoneId) {
       const settings = await prisma.systemSettings.findFirst();
       return { fee: toNumber(settings?.defaultDeliveryFee, 1), zoneId: null, zoneName: 'Default', minOrder: 0 };
    }

    const zone = await prisma.deliveryZone.findUnique({ where: { id: zoneId } });
    if (!zone || !zone.isActive) throw new Error('INVALID_DELIVERY_ZONE');

    const fee = toNumber(zone.fee);
    const minOrder = toNumber(zone.minOrder);

    if (minOrder > 0 && subtotal < minOrder) {
      throw new Error(`MIN_ORDER_NOT_MET:${minOrder}`);
    }

    return { 
      fee, 
      zoneId: zone.id, 
      zoneName: zone.nameAr, 
      minOrder 
    };
  }

  /**
   * 🔢 Generate Unique Atomic Order Number (ORD-YYYYMMDD-XXXX)
   */
  async _generateOrderNumber() {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const counterKey = `order_counter:${dateStr}`;
    const serialNumber = await redis.incr(counterKey);
    
    if (serialNumber === 1) await redis.expire(counterKey, 172800);
    
    const serial = serialNumber.toString().padStart(4, '0');
    const randomSuffix = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `ORD-${dateStr}-${serial}-${randomSuffix}`;
  }

  /**
   * 🚀 Side Effects: Socket notifications, Queue tasks, and Analytics.
   */
  async _triggerPostOrderEffects(order) {
    try {
      // 1. Real-time Admin Socket (Managed by EventBus automatically now)
      // No direct call needed here. publishEvent handles it.

      // 2. Scheduled Auto-Accept (15s delay, 3 retries)
      orderQueue.add('autoAccept', { orderId: order.id }, { 
        delay: 15000, 
        jobId: `autoAccept-${order.id}`,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }
      }).catch((err) => {
        logger.error('[OrderService] Failed to enqueue autoAccept job', { orderId: order.id, error: err.message });
      });

      // 3. Analytics Pulse
      analyticsService.updateCacheIncrementally({
        type: 'ORDER_CREATED',
        amount: toNumber(order.total),
        orderNumber: order.orderNumber,
        action: 'طلب جديد',
        user: order.customerName
      });

      // 4. 💎 Loyalty Hook (Placeholder for future Sprint)
      this._onOrderCompleted(order.id);

    } catch (err) {
      logger.error('Post-order effects error', { orderId: order.id, error: err.message });
    }
  }

  /**
   * 🎁 Loyalty & Rewards Hook (Placeholder)
   * Defered as per Business Design Cycle.
   */
  _onOrderCompleted(orderId) {
    loyaltyService.awardPointsForOrder(orderId).catch(err => {
      logger.error('[Loyalty] Failed to award points on completion', { orderId, error: err.message });
    });
  }

  /**
   * ⚡ Atomic Status Update & State Machine Validation
   */
  async updateOrderStatus(orderId, newStatus) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });

    if (!order || order.status === newStatus) return null;

    const previousStatus = order.status;

    // Validate state machine sequence (Enterprise Guard)
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

    // 📦 Dual-Write: Publish Event to Store (Deduplicated via EventBus)
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
          customerPhone: updatedOrder.customer?.phone || null,
          customer: updatedOrder.customer
        } 
      },
      version: updatedOrder.version
    });
    
    // 📊 Incremental Analytics Update
    analyticsService.updateCacheIncrementally({
      type: 'ORDER_STATUS_CHANGE',
      amount: toNumber(updatedOrder.total),
      status: newStatus,
      previousStatus,
      orderNumber: updatedOrder.orderNumber
    });
    
    // 🎁 Loyalty Reward Hook
    if (newStatus === 'delivered') {
      this._onOrderCompleted(updatedOrder.id);
    }

    return mappedOrder;
  }

  /**
   * Existing Batch Operation Logic
   */
  async batchAcceptOrders(adminEmail) {
    const results = { accepted: 0, skipped: 0 };

    // 1. Fetch pending orders atomically
    const pendingOrders = await prisma.order.findMany({
      where: { status: 'pending' },
      include: ORDER_INCLUDE_FULL
    });

    for (const order of pendingOrders) {
      try {
        // 2. Optimistic lock via version check
        const affected = await prisma.order.updateMany({
          where: {
            id: order.id,
            status: 'pending',
            version: order.version
          },
          data: {
            status: 'preparing',
            version: { increment: 1 },
            updatedAt: new Date()
          }
        });

        if (affected.count > 0) {
          results.accepted++;

          // 3. Audit Log
          await AuditLogger.logOrderChange(prisma, {
            orderId: order.id,
            eventType: 'ORDER_STATUS_CHANGE',
            eventAction: 'BATCH_ACCEPTED',
            changedBy: adminEmail || 'Admin System',
            changedByRole: 'admin',
            previousData: { status: 'pending' },
            newData: { status: 'preparing' }
          });

          // 4. Notification (Centralized via EventBus)
          const mappedOrder = mapOrderResponse({ ...order, status: 'preparing' });
          await publishEvent({
            type: eventTypes.ORDER_STATUS_CHANGED,
            aggregateId: mappedOrder.id,
            payload: {
              previousStatus: 'pending',
              newStatus: 'preparing',
              order: {
                ...mappedOrder,
                id: order.id,
                customerId: order.customerId,
                customerPhone: order.customer?.phone || null,
                customer: order.customer
              }
            },
            version: order.version + 1
          });

          // 5. Analytics — BUG-08 FIX: pending→preparing triggers live revenue
          analyticsService.updateCacheIncrementally({
            type: 'ORDER_STATUS_CHANGE',
            amount: toNumber(order.total),
            status: 'preparing',
            previousStatus: 'pending',
            orderNumber: order.orderNumber,
            action: `قبول تلقائي (batch)`
          });

        } else {
          results.skipped++;
        }
      } catch (err) {
        logger.error('Batch process item error', { orderId: order.id, error: err.message });
        results.skipped++;
      }
    }

    return results;
  }
}

module.exports = new OrderService();
