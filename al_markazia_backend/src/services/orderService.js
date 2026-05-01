/**
 * 🥡 Order Core Service (Refactored)
 * Purpose: Centralized business logic for all order-related operations.
 * Features: Atomic transactions, multi-factor validation, and idempotency support.
 */
const prisma = require('../lib/prisma');
const redis = require('../lib/redis');
const xss = require('xss');
const bcrypt = require('bcrypt');
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
      if (endDate) where.createdAt.lte = new Date(endDate + 'T23:59:59.999Z');
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

    // 🚀 [PERF-FIX] Dedicated Summary Aggregation (Optimized DB Query)
    const summary = await this._calculateReportSummary(where);

    return {
      orders: orders.map(mapOrderResponse),
      total,
      summary,
      page: pageNum,
      limit: limitNum
    };
  }

  /**
   * 📉 Optimized DB-level aggregation for reports
   */
  async _calculateReportSummary(where) {
    const [aggregates, deliveredCount] = await Promise.all([
      prisma.order.aggregate({
        where,
        _sum: { total: true },
        _count: { id: true },
        _avg: { total: true }
      }),
      prisma.order.count({
        where: { ...where, status: 'delivered' }
      })
    ]);

    return {
      totalRevenue: toNumber(aggregates._sum.total),
      orderCount: aggregates._count.id,
      averageOrderValue: toNumber(aggregates._avg.total),
      deliveredCount
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

    const currentOrder = await prisma.order.findUnique({ where: { id: orderId } });
    if (!currentOrder) throw new Error('ORDER_NOT_FOUND');

    const order = await prisma.order.update({
      where: { id: orderId, version: currentOrder.version },
      data: { estimatedReadyAt: date, version: { increment: 1 } },
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
      where: { id: orderId, version: order.version },
      data: {
        preparationTimeMinutes: prepMinutes,
        estimatedReadyAt: newReadyAt,
        estimatedArrivalAt: newArrivalAt,
        version: { increment: 1 }
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

    const isFirstTimeRating = !order.rating;

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: { rating, ratingComment: comment, isRatingApproved: false },
      include: ORDER_INCLUDE_FULL
    });

    // 🎁 Reward points for the review
    if (isFirstTimeRating && order.customerId) {
       try {
         const loyaltyService = require('./loyaltyService');
         await loyaltyService.awardEngagementPoints(order.customerId, 'REVIEW');
       } catch (err) {
         logger.error('Failed to award review points', { error: err.message, orderId });
       }
    }

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
      const result = await prisma.$transaction(async (tx) => {
        // 💰 [FINANCIAL-FIX] Refund on approval
        if (order.paymentMethod === 'wallet' && order.customerId) {
          const walletService = require('./walletService');
          await walletService.credit(
            order.customerId,
            toNumber(order.total),
            'REFUND',
            order.orderNumber,
            `استرداد المبلغ بعد موافقة الإدارة على الإلغاء #${order.orderNumber}`,
            `approve_cancel_${order.id}`,
            tx
          );
        }

        // 📊 [REVENUE-FIX] Set total to 0 on cancellation to prevent reporting errors
        const updated = await tx.order.update({
          where: { id: orderId, version: order.version },
          data: { 
            status: 'cancelled', 
            total: 0, 
            subtotal: 0,
            version: { increment: 1 } 
          },
          include: ORDER_INCLUDE_FULL
        });

        if (order.cancellation) {
          await tx.orderCancellation.update({
            where: { orderId },
            data: { status: 'approved', adminName: user?.email }
          });
        }
        
        const resultData = { order: updated, previousStatus: order.status, newStatus: 'cancelled' };
        
        // 📮 [RESILIENCE-FIX] Transactional Outbox Enqueue
        const outboxService = require('./outboxService');
        const outbox = await outboxService.enqueue(eventTypes.ORDER_STATUS_CHANGED, resultData, tx);

        return { updatedOrder: updated, _outboxId: outbox.id };
      });

      const mapped = mapOrderResponse(result.updatedOrder);
      return { ...mapped, _outboxId: result._outboxId };
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
  async cancelOrder(orderId, user, reason, managerPassword, isRestaurantFault = false) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });

    if (!order) throw new Error('ORDER_NOT_FOUND');

    const isOrderManager = user?.role === 'admin';

    // 🛡️ [CRITICAL] Manager Password Validation for advanced-stage orders
    if (isOrderManager && order.status !== 'pending') {
      if (!managerPassword) {
        throw new Error('MANAGER_PASSWORD_REQUIRED');
      }

      const admin = await prisma.user.findUnique({ where: { uuid: user.id } });
      if (!admin) throw new Error('ADMIN_NOT_FOUND');

      const startTime = Date.now();
      const isPasswordValid = await bcrypt.compare(managerPassword, admin.password);

      // 🛡️ Timing Attack Protection: Ensure comparison takes at least 250ms
      const duration = Date.now() - startTime;
      if (duration < 250) {
        await new Promise(resolve => setTimeout(resolve, 250 - duration));
      }

      if (!isPasswordValid) {
        throw new Error('INVALID_MANAGER_PASSWORD');
      }

      logger.info(`[OrderService] Manager password verified for cancellation of order #${order.orderNumber} by ${user.email}`);
    }

    const canCancelDirectly = isOrderManager || order.status === 'pending';

    const targetStatus = canCancelDirectly ? 'cancelled' : 'waiting_cancellation';
    const cancellationStatus = canCancelDirectly ? 'approved' : 'pending';
    const previousStatus = order.status;

    const updatedOrder = await prisma.$transaction(async (tx) => {
      // 📊 [REVENUE-FIX] Set total to 0 if cancelled directly
      const updated = await tx.order.update({
        where: { id: orderId, version: order.version },
        data: {
          status: targetStatus,
          total: targetStatus === 'cancelled' ? 0 : order.total,
          subtotal: targetStatus === 'cancelled' ? 0 : order.subtotal,
          version: { increment: 1 }
        },
        include: ORDER_INCLUDE_FULL
      });

      // 💰 [FINANCIAL-FIX] Automated Refund for Wallet Payments
      if (targetStatus === 'cancelled' && order.paymentMethod === 'wallet' && order.customerId) {
        const walletService = require('./walletService');
        await walletService.credit(
          order.customerId,
          toNumber(order.total),
          'REFUND',
          order.orderNumber,
          `استرداد كامل المبلغ بسبب إلغاء الطلب #${order.orderNumber}`,
          `cancel_${order.id}`, // Idempotency
          tx
        );
      }

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

    // 🎁 Loyalty Compensation Hook
    // 🛡️ [SEC-FIX]: Use explicit flag instead of string matching to prevent abuse
    if (targetStatus === 'cancelled' && isRestaurantFault === true) {
      loyaltyService.compensatePointsForCancellation(updatedOrder.id, reason).catch(err => {
        logger.error('[Loyalty] Auto-compensation failed', { orderId: updatedOrder.id, error: err.message });
      });
    }

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

    logger.info(`[OrderService] Creating Order. AuthUser: ${authUser?.id}, InputPhone: ${phoneInput}, ResolvedCustomer: ${resolvedCustomer.id}`);

    // 2. 🛡️ Spam Protection (Multi-factor)
    await this._validateSpamLimits(resolvedCustomer.phone);

    // 3. 💰 Pricing & Inventory Validation
    const { validatedItems, subtotal } = await this._calculateAndValidatePricing(cartItems);

    // 4. 🚚 Delivery & Region Validation
    const deliveryDetails = await this._validateDeliveryDetails(orderType, deliveryZoneId, subtotal);

    // 5. 🔢 Generate Atomic Order Number
    const orderNumber = await this._generateOrderNumber();

    // 5.5 🎁 Points Redemption Logic
    let pointsDiscount = 0;
    let pointsToDeduct = 0;

    if (data.usePoints === true) {
      const loyaltyConfig = await loyaltyService.getConfig();
      const minPoints = loyaltyConfig.minPointsToRedeem || 500;
      const rate = loyaltyConfig.pointsToJodRate || 100;
      
      if (resolvedCustomer.points >= minPoints) {
        // Calculate max cash value from points
        const rawDiscount = resolvedCustomer.points / rate;
        // Cap discount to subtotal
        pointsDiscount = Math.min(rawDiscount, subtotal);
        // Calculate exact points to deduct
        pointsToDeduct = Math.floor(pointsDiscount * rate);
      }
    }

    // 🛡️ Pricing Logic: Inclusive of Tax
    const tax = 0;
    const total = Math.max(0, toMoney(subtotal + deliveryDetails.fee - pointsDiscount));

    // 🚀 Auto Accept Orders Logic
    let sysSettings = memoryCache.get('system:settings');
    if (!sysSettings) {
      const redisSettings = await redis.get('system:settings');
      if (redisSettings) sysSettings = JSON.parse(redisSettings);
      else sysSettings = await prisma.systemSettings.findFirst();
    }
    const isAutoAccept = sysSettings?.autoAcceptOrders === 'true' || sysSettings?.autoAcceptOrders === true;
    const initialStatus = isAutoAccept ? 'preparing' : 'pending';

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
          status: initialStatus,
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

      // 💳 Execute Points Deduction if requested
      if (pointsToDeduct > 0) {
        await tx.customer.update({
          where: { id: resolvedCustomer.id },
          data: { points: { decrement: pointsToDeduct } }
        });

        await tx.customerAuditLog.create({
          data: {
            customerId: resolvedCustomer.id,
            action: 'POINTS_REDEEMED',
            oldValue: resolvedCustomer.points,
            newValue: resolvedCustomer.points - pointsToDeduct,
            actorId: resolvedCustomer.id,
            reason: `استخدام النقاط للخصم من الطلب #${order.orderNumber}`,
            metadata: { orderId: order.id, pointsDeducted: pointsToDeduct, discount: pointsDiscount }
          }
        });

        await tx.financialLedger.create({
          data: {
            customerId: resolvedCustomer.id,
            orderId: order.id,
            type: 'DEBIT',
            category: 'ORDER_PAYMENT',
            amount: pointsDiscount,
            balanceBefore: resolvedCustomer.walletBalance,
            balanceAfter: resolvedCustomer.walletBalance,
            method: 'POINTS',
            description: `دفع جزئي باستخدام النقاط للطلب #${order.orderNumber}`,
            metadata: { pointsDeducted: pointsToDeduct }
          }
        });
      }

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
      if (customer) {
        resolvedPhone = customer.phone;
        logger.debug(`[OrderService] Found customer by UUID ${authUser.id}: ID ${customer.id}`);
      } else {
        logger.debug(`[OrderService] No customer found for UUID ${authUser.id}. User role: ${authUser.role}`);
        // If it's an admin, we allow fallback to phone (for manual orders)
        // If it's a customer but UUID not found (stale token), we should NOT fallback to another customer's phone
        if (authUser.role !== 'admin' && authUser.role !== 'super_admin') {
          logger.warn(`[OrderService] Authenticated customer UUID not found. Blocking fallback to prevent misattribution.`);
          return { id: null, phone: phone }; // Treat as Guest instead of linking to wrong ID
        }
      }
    }

    if (!customer) {
      customer = await prisma.customer.findUnique({ where: { phone: resolvedPhone } });
      if (customer) {
        logger.debug(`[OrderService] Found customer by Phone ${resolvedPhone}: ID ${customer.id}`);
      } else {
        logger.debug(`[OrderService] No customer found for Phone ${resolvedPhone}`);
      }
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
      if (!dbItem.isAvailable) throw new Error(`ITEM_UNAVAILABLE:${dbItem.title}`);

      let unitPrice = toNumber(dbItem.basePrice);
      const optionIds = item.optionIds || [];

      if (optionIds.length > 0) {
        const dbOptions = await prisma.itemOption.findMany({
          where: { id: { in: optionIds.map(id => parseInt(id)) } },
          include: { group: true }
        });

        for (const opt of dbOptions) {
          if (opt.group.itemId !== dbItem.id) throw new Error('DATA_INTEGRITY_VIOLATION');
          if (!opt.isAvailable) throw new Error(`OPTION_UNAVAILABLE:${opt.name}`);
          unitPrice += toNumber(opt.price);
        }
      }

      const qty = parseInt(item.quantity);
      if (isNaN(qty) || qty <= 0) throw new Error(`INVALID_QUANTITY:${dbItem.title}`);

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
  async updateOrderStatus(orderId, newStatus, version = null) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });

    if (!order || order.status === newStatus) return null;

    // 🛡️ [SEC-FIX] Optimistic Locking Validation
    if (version !== null && version !== undefined && order.version !== parseInt(version)) {
      throw new Error('CONCURRENCY_CONFLICT');
    }

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

    const { updatedOrder, _outboxId } = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: order.id, version: order.version },
        data: { status: newStatus, version: { increment: 1 } },
        include: ORDER_INCLUDE_FULL
      });

      // 🎁 Loyalty Reward Hook (Inline for synchronous points in notification)
      let pointsEarned = 0;
      if (newStatus === 'delivered') {
        try {
          pointsEarned = await loyaltyService.awardPointsForOrder(updated, tx);
        } catch (err) {
          logger.error('[Loyalty] Failed to award points on status update', { orderId: updated.id, error: err.message });
        }
      }

      // 📮 [RESILIENCE-FIX] Transactional Outbox Enqueue
      const outboxService = require('./outboxService');
      const outbox = await outboxService.enqueue(eventTypes.ORDER_STATUS_CHANGED, {
        previousStatus,
        newStatus,
        order: {
          ...mapOrderResponse(updated),
          pointsEarned
        }
      }, tx);

      return { updatedOrder: updated, _outboxId: outbox.id };
    });

    const mappedOrder = mapOrderResponse(updatedOrder);

    // 📊 Incremental Analytics Update
    analyticsService.updateCacheIncrementally({
      type: 'ORDER_STATUS_CHANGE',
      amount: toNumber(updatedOrder.total),
      status: newStatus,
      previousStatus,
      orderNumber: updatedOrder.orderNumber
    });

    return { ...mappedOrder, _outboxId };
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
