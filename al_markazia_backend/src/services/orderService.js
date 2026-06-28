/**
 * 🥡 Order Core Service (Refactored)
 * Purpose: Centralized business logic for all order-related operations.
 * Features: Atomic transactions, multi-factor validation, and idempotency support.
 */
const { ORDER_INCLUDE_FULL } = require('../shared/prismaConstants');
const { hashBlind, decrypt, encrypt } = require('../utils/crypto');
const { mapOrderResponse } = require('../mappers/order.mapper');
const { publishEvent } = require('../events/eventPublisher');
const eventTypes = require('../events/eventTypes');
const queryOptimizer = require('../utils/queryOptimizer');
const { toNumber, toMoney } = require('../utils/number');
const { validateTransition } = require('../validators/orderStateMachine');
const configService = require('./configService');
const liveCacheService = require('./liveCacheService');
const { orderQueue } = require('../queues/orderQueue');
const xss = require('xss');
const NodeCache = require('node-cache');
const memoryCache = new NodeCache({ stdTTL: 300 });
const AuditLogger = require('../utils/auditLogger');

const safeJsonParse = (str) => {
  try { return JSON.parse(str); } catch (e) { return null; }
};

class OrderService {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.redis = container.redis;
    this.logger = container.logger;
  }
  /**
   * 🛡️ Safe Feature Flag Check — defaults to optimizer ON if Redis is down
   */
  async _shouldUseOptimizer() {
    try {
      return await this.container.featureFlagsService.isEnabled('USE_QUERY_OPTIMIZER');
    } catch (err) {
      this.logger.error('[OrderService] Feature flag check failed', { error: err.message });
      return true;
    }
  }

  async bumpBranchVersion(branchId) {
    if (!branchId) return;
    await this.redis.incr(`branch_version:${branchId}`);
    this.logger.debug(`[OrderSync] 🆙 Version bumped for branch ${branchId}`);
  }

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

    // 🏢 Multi-Branch Isolation (v3.0: SecurityPolicyService)
    const SecurityPolicyService = require('./securityPolicyService');
    const { getContext } = require('../utils/securityContext');
    const isolationFilter = await this.container.securityPolicyService.getHardenedFilter(getContext(), 'Order');

    Object.assign(where, isolationFilter);

    const pageNum = page ? Math.max(1, parseInt(page)) : null;
    const limitNum = limit ? Math.min(1000, parseInt(limit)) : 500;
    const skipNum = pageNum ? (pageNum - 1) * limitNum : 0;

    // 🚀 [PERF-FIX] Use QueryOptimizer to prevent N+1 on large result sets
    const useOptimizer = await this._shouldUseOptimizer();

    const [orders, total] = await Promise.all([
      useOptimizer
        ? queryOptimizer.fetchOrdersOptimized(where, { createdAt: 'desc' }, skipNum, limitNum)
        : this.prisma.order.findMany({
            where,
            include: ORDER_INCLUDE_FULL,
            orderBy: { createdAt: 'desc' },
            ...(pageNum ? { skip: skipNum, take: limitNum } : { take: limitNum })
          }),
      this.prisma.order.count({ where })
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
    const [aggregates, realizedAggregates, deliveredCount] = await Promise.all([
      this.prisma.order.aggregate({
        where: { ...where, status: { not: 'cancelled' } }, // 📊 [FINANCIAL-FIX] Exclude cancelled from gross revenue
        _sum: { total: true },
        _count: { id: true },
        _avg: { total: true }
      }),
      this.prisma.order.aggregate({
        where: { ...where, status: 'delivered' },
        _sum: { total: true }
      }),
      this.prisma.order.count({
        where: { ...where, status: 'delivered' }
      })
    ]);

    return {
      totalRevenue: toNumber(realizedAggregates._sum.total), // Only count delivered for "Realized"
      grossRevenue: toNumber(aggregates._sum.total),     // All orders (excluding cancelled which are 0)
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

    const where = { isDeleted: false, isArchived: false };
    if (active_only === 'true') {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      where.status = { notIn: ['delivered', 'cancelled'] };
      where.createdAt = { gte: twentyFourHoursAgo };
    } else if (status) {
      where.status = status;
    }

    if (search) {
      const { hashBlind } = require('../utils/crypto');
      const hashedSearch = hashBlind(search);

      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerNameHash: hashedSearch },
        { customerPhoneHash: hashedSearch }
      ];
    }

    // 🏢 Multi-Branch Isolation (v3.0: SecurityPolicyService)
    const SecurityPolicyService = require('./securityPolicyService');
    const { getContext } = require('../utils/securityContext');
    const isolationFilter = await this.container.securityPolicyService.getHardenedFilter(getContext(), 'Order');

    Object.assign(where, isolationFilter);

    // 🚀 [PERF-FIX] Use QueryOptimizer to prevent N+1 on dashboard lists
    const useOptimizer = await this._shouldUseOptimizer();

    const [orders, total, statusCounts] = await Promise.all([
      useOptimizer
        ? queryOptimizer.fetchOrdersOptimized(where, { createdAt: 'desc' }, skip, limit)
        : this.prisma.order.findMany({
            where,
            include: ORDER_INCLUDE_FULL,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit
          }),
      this.prisma.order.count({ where }),
      this.prisma.order.groupBy({
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
   * ⚡ High-Speed Synchronization
   * Returns latest state only if version has changed.
   */
  async syncOrders(user, clientVersion) {
    const { getBranchId } = require('../utils/context');
    const branchId = getBranchId() || user.branchId;
    
    if (!branchId) throw new Error('BRANCH_CONTEXT_REQUIRED');

    const redis = require('../lib/redis');
    const serverVersion = await redis.get(`branch_version:${branchId}`) || '0';
    
    if (clientVersion === serverVersion) {
      return { upToDate: true, version: serverVersion };
    }
    
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const syncWhere = { 
      branchId, 
      status: { notIn: ['delivered', 'cancelled'] },
      isDeleted: false,
      isArchived: false,
      createdAt: { gte: twentyFourHoursAgo }
    };

    // 🚀 [PERF-FIX] Use QueryOptimizer for sync (can be up to 200 orders)
    const useOptimizer = await this._shouldUseOptimizer();

    const orders = useOptimizer
      ? await queryOptimizer.fetchOrdersOptimized(syncWhere, { updatedAt: 'desc' }, 0, 200)
      : await this.prisma.order.findMany({
          where: syncWhere,
          include: ORDER_INCLUDE_FULL,
          orderBy: { updatedAt: 'desc' },
          take: 200
        });
    
    return { 
      upToDate: false, 
      version: serverVersion, 
      orders: orders.map(mapOrderResponse) 
    };
  }

  /**
   * 👤 Fetch Customer-Specific Orders
   */
  async getCustomerOrders(userUuid, query) {
    const { status, active_only } = query;
    const { page, limit, skip } = require('../utils/pagination').parsePagination(query);

    const customer = await this.prisma.customer.findUnique({
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

    // 🚀 [PERF-FIX] Use QueryOptimizer for customer order history
    const useOptimizer = await this._shouldUseOptimizer();

    const [orders, total] = await Promise.all([
      useOptimizer
        ? queryOptimizer.fetchOrdersOptimized(where, { createdAt: 'desc' }, skip, limit)
        : this.prisma.order.findMany({
            where,
            include: ORDER_INCLUDE_FULL,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit
          }),
      this.prisma.order.count({ where })
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
  async requestPartialCancel(orderId, items, reason, actor = null, metadata = {}) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });

    if (!order) throw new Error('ORDER_NOT_FOUND');

    // 🔒 Enforce Centralized Ownership Guard to prevent IDOR
    await this.validateOwnership(order, actor);

    await this.prisma.notification.create({
      data: {
        customerId: order.customerId,
        title: 'طلب إلغاء جزئي ⚠️',
        message: `طلب تعديل للطلب #${order.orderNumber} من ${order.customerName}\nالمبلغ المسترد المتوقع: ${metadata.refundAmount || 0}`,
        type: 'partial_cancel_requested',
        orderId: order.id,
        targetRoute: `/orders?id=${order.id}`,
        metadata: JSON.stringify({
          items: items.map(i => (typeof i === 'number' ? i : i.id)),
          reason,
          refundAmount: metadata.refundAmount,
          requestedBy: actor?.id || metadata.requestedBy,
          requestedAt: metadata.requestedAt || new Date().toISOString()
        })
      }
    });

    return {
      success: true,
      refundAmount: metadata.refundAmount,
      notificationSent: true
    };
  }

  /**
   * ⚡ Apply Partial Cancellation (Administrative Action)
   * Atomic removal of items and price adjustment
   */
  async applyPartialCancellation(orderId, itemIdsToCancel, actor, notificationId, managerPassword = null) {
    // 🛡️ [SEC-FIX] Enforce Re-auth for Administrative Action
    await this._verifyManagerPassword(actor.id, managerPassword);

    const { toNumber, toMoneyString } = require('../utils/number');
    
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Fetch order with items
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { orderItems: true }
      });

      if (!order) throw new Error('ORDER_NOT_FOUND');

      // 2. Filter items to keep
      const itemsToKeep = order.orderItems.filter(item => !itemIdsToCancel.includes(item.id));
      const itemsCancelled = order.orderItems.filter(item => itemIdsToCancel.includes(item.id));

      if (itemsToKeep.length === 0) {
        throw new Error('CANNOT_CANCEL_ALL_ITEMS: Use full cancellation instead');
      }

      // 3. Recalculate Totals via Canonical Pricing Engine
      const pricingService = require('./pricingService');
      const systemConfig = await configService.getFullConfig();
      const financials = pricingService.calculateOrderTotals(
        itemsToKeep, 
        toNumber(order.deliveryFee), 
        toNumber(order.discount),
        systemConfig.business.taxRate
      );

      // 🛡️ [BUG-03 FIX] Calculate refund amount directly to avoid calling non-existent calculateImpact
      const refundAmount = toNumber(order.total) - financials.total;

      // 4. Update Database using precise Decimal strings to guarantee strict alignment with Prisma schema
      const updatedOrder = await tx.order.update({
        where: { id: orderId, version: order.version },
        data: {
          total: toMoneyString(financials.total),
          subtotal: toMoneyString(financials.subtotal),
          tax: toMoneyString(financials.tax),
          version: { increment: 1 },
          orderItems: {
            deleteMany: {
              id: { in: itemIdsToCancel }
            }
          }
        },
        include: { orderItems: true, customer: true }
      });

      // 💳 [BUG-02 FIX] Credit the partial refund to the customer's wallet if paid by wallet
      if (order.paymentMethod === 'wallet' && refundAmount > 0) {
        await this.container.walletService.credit(
          order.customerId,
          refundAmount,
          'REFUND',
          order.orderNumber,
          `Partial refund for order #${order.orderNumber}`,
          `partial_cancel_refund:${order.id}:${itemIdsToCancel.join('_')}`,
          tx
        );
      }

      // 5. Resolve Notification
      if (notificationId) {
        await tx.notification.update({
          where: { id: notificationId },
          data: { isRead: true }
        });
      }

      // 6. Log Financial Adjustment
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          userRole: actor.role,
          action: 'PARTIAL_CANCELLATION_APPLIED',
          entityType: 'Order',
          entityId: orderId.toString(),
          metadata: JSON.stringify({
            cancelledItemIds: itemIdsToCancel,
            refundAmount,
            oldTotal: order.total,
            newTotal: financials.total
          })
        }
      });

      return {
        success: true,
        order: updatedOrder,
        refundAmount
      };
    }, { timeout: 15000 });

    // 7. Notify Customer (OUTSIDE Transaction)
    try {
      const notificationService = require('./notificationService');
      await this.container.notificationService.sendToUser(result.order.customerId, {
        title: 'تعديل طلبك بنجاح ✅',
        message: `تمت الموافقة على تعديل الطلب #${result.order.orderNumber}. المبلغ المسترد: ${result.refundAmount.toFixed(2)}`,
        type: 'order_adjusted',
        orderId: result.order.id
      });
    } catch (err) {
      this.logger.error('Failed to send notification after partial cancellation', { error: err.message });
    }

    return result;
  }

  /**
   * 🔄 Branch suggests replacement for an unavailable order item
   */
  async suggestReplacement(orderId, itemId, alternativeItemId, actor) {
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Fetch order with items
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { orderItems: true }
      });

      if (!order) throw new Error('ORDER_NOT_FOUND');

      // 2. Fetch order item to replace
      const orderItem = order.orderItems.find(item => item.id === itemId);
      if (!orderItem) throw new Error('ORDER_ITEM_NOT_FOUND');
      if (orderItem.status !== 'normal') throw new Error('INVALID_ITEM_STATUS');

      // 3. Fetch alternative item
      const alternativeItem = await tx.item.findUnique({
        where: { id: alternativeItemId },
        include: { branchItems: { where: { branchId: order.branchId } } }
      });

      if (!alternativeItem) throw new Error('ALTERNATIVE_ITEM_NOT_FOUND');

      const branchItem = alternativeItem.branchItems[0];
      if (!alternativeItem.isAvailable || (branchItem && !branchItem.isAvailable)) {
        throw new Error('ALTERNATIVE_ITEM_UNAVAILABLE');
      }

      // 4. Update the order item
      const updatedItem = await tx.orderItem.update({
        where: { id: itemId },
        data: {
          status: 'pending_replacement_approval',
          suggestedReplacementItemId: alternativeItemId,
          replacementStatus: 'PENDING'
        }
      });

      // 5. Create Audit Log
      await tx.orderAuditLog.create({
        data: {
          orderId: order.id,
          eventType: 'ORDER_REPLACEMENT_SUGGESTED',
          eventAction: 'SUGGEST_REPLACEMENT',
          changedBy: actor.uuid || actor.id?.toString() || 'SYSTEM',
          changedByRole: actor.role || 'system',
          newData: JSON.stringify({ itemId, suggestedReplacementItemId: alternativeItemId })
        }
      });

      return {
        order,
        orderItem: updatedItem,
        alternativeItemName: alternativeItem.title
      };
    }, { timeout: 15000 });

    // 6. Schedule background timeout (15 minutes)
    try {
      const { orderQueue } = require('../queues/orderQueue');
      await orderQueue.add(
        'replacement-timeout',
        { orderId, itemId, type: 'replacement-timeout' },
        { delay: 15 * 60 * 1000 } // 15 minutes
      );
    } catch (err) {
      this.logger.error('Failed to schedule replacement timeout job', { error: err.message });
    }

    // 7. Send notification to customer
    try {
      if (result.order.customerId) {
        await this.container.notificationService.sendToUser(result.order.customerId, {
          title: 'مقترح استبدال صنف 🔄',
          message: `المطعم يقترح استبدال صنف [${result.orderItem.itemName}] بصنف [${result.alternativeItemName}]. لديك 15 دقيقة للموافقة أو الرفض.`,
          type: 'replacement_suggested',
          orderId: result.order.id
        });
      }
    } catch (err) {
      this.logger.error('Failed to send replacement notification to customer', { error: err.message });
    }

    return {
      success: true,
      orderItem: result.orderItem
    };
  }

  /**
   * 🔄 Customer (or System Timeout) responds to replacement suggestion
   */
  async respondReplacement(orderId, itemId, accept, preference = 'DEDUCT_FROM_BILL', actor) {
    const { toNumber, toMoneyString } = require('../utils/number');
    const pricingService = require('./pricingService');

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Fetch order with items
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { orderItems: true }
      });

      if (!order) throw new Error('ORDER_NOT_FOUND');

      // 2. Fetch the order item
      const orderItem = order.orderItems.find(item => item.id === itemId);
      if (!orderItem) throw new Error('ORDER_ITEM_NOT_FOUND');
      if (orderItem.status !== 'pending_replacement_approval') {
        throw new Error('INVALID_ITEM_STATUS');
      }

      let updatedOldItem;
      let newOrderItem;
      let itemsToKeep = [];

      if (accept) {
        // Fetch alternative item
        const alternativeItem = await tx.item.findUnique({
          where: { id: orderItem.suggestedReplacementItemId }
        });
        if (!alternativeItem) throw new Error('SUGGESTED_ITEM_NOT_FOUND');

        // A. Mark old item as cancelled and replacementStatus = ACCEPTED
        updatedOldItem = await tx.orderItem.update({
          where: { id: itemId },
          data: {
            status: 'cancelled',
            replacementStatus: 'ACCEPTED'
          }
        });

        // B. Create new OrderItem
        newOrderItem = await tx.orderItem.create({
          data: {
            orderId: order.id,
            itemId: alternativeItem.id,
            itemName: alternativeItem.title,
            itemNameEn: alternativeItem.titleEn,
            quantity: orderItem.quantity,
            unitPrice: alternativeItem.basePrice,
            lineTotal: toNumber(alternativeItem.basePrice) * orderItem.quantity,
            replacedFromId: itemId,
            status: 'normal'
          }
        });

        // C. Calculate new totals
        const activeItems = order.orderItems.filter(
          item => item.id !== itemId && ['normal', 'pending_partial_cancel'].includes(item.status)
        );
        activeItems.push(newOrderItem);
        itemsToKeep = activeItems;

      } else {
        // Reject replacement
        // A. Mark old item as cancelled and replacementStatus = REJECTED
        updatedOldItem = await tx.orderItem.update({
          where: { id: itemId },
          data: {
            status: 'cancelled',
            replacementStatus: 'REJECTED',
            resolutionPreference: preference
          }
        });

        // B. Create Coupon Request if selected
        if (preference === 'COUPON_REQUEST') {
          const existingCoupon = await tx.couponRequest.findFirst({
            where: { orderId: order.id, itemId: orderItem.itemId }
          });
          if (!existingCoupon) {
            await tx.couponRequest.create({
              data: {
                orderId: order.id,
                customerId: order.customerId,
                itemId: orderItem.itemId || 0,
                itemPrice: orderItem.unitPrice,
                status: 'PENDING'
              }
            });
          }
        }

        // C. Calculate new totals
        itemsToKeep = order.orderItems.filter(
          item => item.id !== itemId && ['normal', 'pending_partial_cancel'].includes(item.status)
        );
      }

      if (itemsToKeep.length === 0) {
        throw new Error('CANNOT_CANCEL_ALL_ITEMS: Order must contain at least one item.');
      }

      // D. Recalculate Totals
      const systemConfig = await configService.getFullConfig();
      const financials = pricingService.calculateOrderTotals(
        itemsToKeep,
        toNumber(order.deliveryFee),
        toNumber(order.discount),
        systemConfig.business.taxRate
      );

      // E. Update Order
      const updatedOrder = await tx.order.update({
        where: { id: orderId, version: order.version },
        data: {
          total: toMoneyString(financials.total),
          subtotal: toMoneyString(financials.subtotal),
          tax: toMoneyString(financials.tax),
          version: { increment: 1 }
        },
        include: { orderItems: true, customer: true }
      });

      // F. Create Audit Log
      await tx.orderAuditLog.create({
        data: {
          orderId: order.id,
          eventType: accept ? 'ORDER_REPLACEMENT_ACCEPTED' : 'ORDER_REPLACEMENT_REJECTED',
          eventAction: 'RESPOND_REPLACEMENT',
          changedBy: actor.uuid || actor.id?.toString() || 'SYSTEM',
          changedByRole: actor.role || 'system',
          newData: JSON.stringify({ itemId, accept, preference })
        }
      });

      return {
        order: updatedOrder,
        accept,
        preference,
        oldItemName: orderItem.itemName
      };
    }, { timeout: 15000 });

    // 3. Send notifications
    try {
      if (result.order.customerId) {
        const title = accept ? 'تم استبدال الصنف بنجاح ✅' : 'تم إلغاء الصنف من الطلب ⚠️';
        const message = accept
          ? `تمت الموافقة على استبدال الصنف [${result.oldItemName}] في الطلب #${result.order.orderNumber}.`
          : `تم إلغاء الصنف [${result.oldItemName}] وخصم قيمته من الفاتورة للطلب #${result.order.orderNumber}.` +
            (preference === 'COUPON_REQUEST' ? ' تم إرسال طلب كوبون خصم للمراجعة خلال 24 ساعة.' : '');

        await this.container.notificationService.sendToUser(result.order.customerId, {
          title,
          message,
          type: accept ? 'replacement_accepted' : 'replacement_rejected',
          orderId: result.order.id
        });
      }
    } catch (err) {
      this.logger.error('Failed to send notification to customer', { error: err.message });
    }

    return {
      success: true,
      order: result.order
    };
  }

  /**
   * 🎟️ Customer requests a discount coupon for a cancelled order item
   */
  async requestCouponForCancelledItem(orderId, itemId, actor) {
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Fetch order
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { orderItems: true }
      });

      if (!order) throw new Error('ORDER_NOT_FOUND');

      // Ownership check
      if (order.customerId !== actor.id && actor.role !== 'ADMIN') {
        throw new Error('UNAUTHORIZED_ORDER_ACCESS');
      }

      // 2. Fetch order item
      const orderItem = order.orderItems.find(item => item.id === itemId);
      if (!orderItem) throw new Error('ORDER_ITEM_NOT_FOUND');
      if (orderItem.status !== 'cancelled') throw new Error('ITEM_NOT_CANCELLED');

      // 3. Check for existing coupon request
      const existingRequest = await tx.couponRequest.findFirst({
        where: { orderId, itemId: orderItem.itemId }
      });
      if (existingRequest) throw new Error('COUPON_REQUEST_ALREADY_EXISTS');

      // 4. Create Coupon Request
      const couponRequest = await tx.couponRequest.create({
        data: {
          orderId: order.id,
          customerId: order.customerId,
          itemId: orderItem.itemId || 0,
          itemPrice: orderItem.unitPrice,
          status: 'PENDING'
        }
      });

      // 5. Update OrderItem preference
      await tx.orderItem.update({
        where: { id: itemId },
        data: { resolutionPreference: 'COUPON_REQUEST' }
      });

      // 6. Create Audit Log
      await tx.orderAuditLog.create({
        data: {
          orderId: order.id,
          eventType: 'COUPON_REQUEST_CREATED',
          eventAction: 'REQUEST_COUPON',
          changedBy: actor.uuid || actor.id.toString(),
          changedByRole: actor.role,
          newData: JSON.stringify({ itemId })
        }
      });

      return couponRequest;
    }, { timeout: 15000 });

    return {
      success: true,
      couponRequest: result
    };
  }

  /**
   * ⏲️ Update estimated ready time
   */
  async updateOrderTimer(orderId, estimatedReadyAt, user = null) {
    const date = new Date(estimatedReadyAt);
    if (isNaN(date.getTime())) throw new Error('INVALID_DATE');

    const currentOrder = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!currentOrder) throw new Error('ORDER_NOT_FOUND');

    // 🛡️ [SEC-FIX] Branch Isolation (Defense in Depth)
    if (user) {
      const role = user.role?.toLowerCase();
      if (['manager', 'branch_manager'].includes(role) && currentOrder.branchId !== user.branchId) {
        logger.security('UNAUTHORIZED_TIMER_UPDATE_ATTEMPT', { userId: user.id, orderId, branchId: currentOrder.branchId });
        throw new Error('ORDER_FORBIDDEN');
      }
    }

    const order = await this.prisma.order.update({
      where: { id: orderId, version: currentOrder.version },
      data: { estimatedReadyAt: date, version: { increment: 1 } },
      include: ORDER_INCLUDE_FULL
    });

    // ⚡ Sync Protocol: Bump branch version
    await this.bumpBranchVersion(order.branchId);

    return mapOrderResponse(order);
  }

  /**
   * 👩‍🍳 Update Preparation Time (Minutes)
   */
  async updatePreparationTime(orderId, minutes, user = null) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error('ORDER_NOT_FOUND');

    // 🛡️ [SEC-FIX] Branch Isolation (Defense in Depth)
    if (user) {
      const role = user.role?.toLowerCase();
      if (['manager', 'branch_manager'].includes(role) && order.branchId !== user.branchId) {
        logger.security('UNAUTHORIZED_PREP_UPDATE_ATTEMPT', { userId: user.id, orderId, branchId: order.branchId });
        throw new Error('ORDER_FORBIDDEN');
      }
    }

    const prepMinutes = parseInt(minutes);
    const delMinutes = order.deliveryTimeMinutes || 15;

    const newReadyAt = new Date(order.createdAt.getTime() + prepMinutes * 60000);
    const newArrivalAt = new Date(order.createdAt.getTime() + (prepMinutes + delMinutes) * 60000);

    const updated = await this.prisma.order.update({
      where: { id: orderId, version: order.version },
      data: {
        preparationTimeMinutes: prepMinutes,
        estimatedReadyAt: newReadyAt,
        estimatedArrivalAt: newArrivalAt,
        version: { increment: 1 }
      },
      include: ORDER_INCLUDE_FULL
    });

    // ⚡ Sync Protocol: Bump branch version
    await this.bumpBranchVersion(updated.branchId);

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
    // 🗑️ Handle rating removal
    if (rating === null) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { rating: null, ratingComment: null, isRatingApproved: false }
      });
      return { success: true, message: 'Rating removed' };
    }

    if (!rating || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('INVALID_RATING');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });

    if (!order) throw new Error('ORDER_NOT_FOUND');

    // 🛡️ [SEC-FIX] Granular Authorization Guard
    if (user) {
      const role = user.role?.toLowerCase();
      
      // Customer: Must be the owner of the order
      if (role === 'customer') {
        if (order.customer?.uuid !== user.id) {
          throw new Error('ORDER_FORBIDDEN');
        }
      }
      
      // Manager/Branch Manager: Must belong to the same branch
      if (['manager', 'branch_manager'].includes(role)) {
        if (order.branchId !== user.branchId) {
          throw new Error('ORDER_FORBIDDEN');
        }
      }
      
      // Admin: Restricted admins must belong to the same branch
      if (role === 'admin' && user.branchId && order.branchId !== user.branchId) {
        throw new Error('ORDER_FORBIDDEN');
      }
    } else {
      // Guest users cannot rate orders
      throw new Error('ORDER_FORBIDDEN');
    }

    const isFirstTimeRating = !order.rating;

    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId, version: order.version },
      data: { rating, ratingComment: comment, isRatingApproved: false, version: { increment: 1 } },
      include: ORDER_INCLUDE_FULL
    });

    // 🎁 Reward points for the review
    if (isFirstTimeRating && order.customerId) {
       try {
         const loyaltyService = require('./loyaltyService');
         await this.container.loyaltyService.awardEngagementPoints(order.customerId, 'REVIEW');
       } catch (err) {
         logger.error('Failed to award review points', { error: err.message, orderId });
       }
    }

    return mapOrderResponse(updatedOrder);
  }

  /**
   * 🛠️ Manage Cancellation Requests (Approve/Reject)
   */
  async handleCancellationRequest(orderId, user, action, rejectionReason, externalTx = null, approvalId = null, managerPassword = null) {
    // 🛡️ [SEC-FIX] Enforce Re-auth for Administrative Approval
    if (action === 'approve') {
      await this._verifyManagerPassword(user.id, managerPassword);
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { cancellation: true, customer: true }
    });

    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.status !== 'waiting_cancellation' && order.status !== 'waiting_cancellation_admin') {
      throw new Error('NOT_PENDING_CANCELLATION');
    }

    if (action === 'approve') {
      const result = await this.container.cancellationOrchestrator.execute(orderId, user, { 
        source: 'ADMIN_APPROVAL', 
        managerPassword,
        skipPasswordCheck: true // Already checked in handleCancellationRequest
      });

      const mapped = mapOrderResponse(result.updatedOrder);
      return { ...mapped, _outboxId: result._outboxId };
    } else {
      // Reject — restore previous status
      const previousStatus = order.cancellation?.previousStatus || 'preparing';
      const result = await this.updateOrderStatus(orderId, previousStatus, null, user);
      if (order.cancellation) {
        await this.prisma.orderCancellation.update({
          where: { orderId },
          data: { status: 'rejected', rejectionReason, adminName: user?.email }
        });
      }
      return result;
    }
  }

  /**
   * 🛡️ Centralized Ownership Guard (validateOwnership)
   * Validates granular order ownership against authenticated user tokens.
   * Handles automatic resolution between Token UUIDs and DB Integer IDs.
   * @param {Object} order - Order object retrieved from DB
   * @param {Object} user - Current user object from JWT
   * @throws {Error} if access is forbidden
   */
  async validateOwnership(order, user) {
    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (!user) throw new Error('UNAUTHORIZED_ORDER_ACCESS');

    const role = user.role?.toLowerCase() || 'customer';

    // 1. Admins and Branch Managers have administrative clearance
    if (['admin', 'branch_manager'].includes(role)) {
      return true;
    }

    // 2. Registered Customers: must strictly match customerId
    if (role === 'customer') {
      if (!order.customerId) {
        throw new Error('ORDER_FORBIDDEN: This order does not belong to any registered account.');
      }

      // Check populated relation UUID if available
      if (order.customer && order.customer.uuid === user.id) {
        return true;
      }

      // Resolve via DB query to map string UUID to integer ID
      const customer = await this.prisma.customer.findUnique({
        where: { uuid: user.id },
        select: { id: true }
      });

      if (!customer || order.customerId !== customer.id) {
        this.logger.error('[Security Guard] IDOR access blocked: Customer ownership mismatch', { requestedOrderId: order.id, authenticatedUserUuid: user.id });
        throw new Error('ORDER_FORBIDDEN: You do not own this order.');
      }

      return true;
    }

    throw new Error('ORDER_FORBIDDEN: Insufficient permissions.');
  }

  /**
   * 🎯 Fetch Unique Order with Details
   */
  async getOrderById(orderId, user = null) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        ...ORDER_INCLUDE_FULL,
        auditLogs: { orderBy: { createdAt: 'desc' }, take: 10 },
        customer: true // Ensure customer object is loaded for ownership validation
      }
    });

    if (!order) return null;

    // 🔒 Enforce Centralized Ownership Guard to prevent IDOR completely
    await this.validateOwnership(order, user);

    // If actor is staff/admin/manager, enforce branch-level access control boundaries
    if (user && user.role?.toLowerCase() !== 'customer') {
      const SecurityPolicyService = require('./securityPolicyService');
      const hasAccess = await this.container.securityPolicyService.canAccessBranch(user, order.branchId);
      if (!hasAccess) {
        throw new Error('ORDER_FORBIDDEN');
      }
    }

    return mapOrderResponse(order);
  }

  /**
   * 🛡️ [SEC-FIX] Verify Manager Password
   * Re-authenticates the administrative user before sensitive operations.
   */
  async _verifyManagerPassword(userUuid, managerPassword) {
    // 1. Requirement Check
    if (!managerPassword) {
      throw new Error('MANAGER_PASSWORD_REQUIRED');
    }

    // 2. Identity Fetch
    const admin = await this.prisma.user.findUnique({
      where: { uuid: userUuid },
      select: { password: true }
    });

    if (!admin) {
      throw new Error('ADMIN_IDENTITY_NOT_FOUND');
    }

    // 3. Cryptographic Verification
    const bcrypt = require('bcrypt');
    const isValid = await bcrypt.compare(managerPassword, admin.password);

    if (!isValid) {
      this.logger.security('INVALID_MANAGER_PASSWORD_ATTEMPT', { userId: userUuid });
      throw new Error('INVALID_MANAGER_PASSWORD');
    }

    return true;
  }

  /**
   * 🛑 Cancel Order (Wrapper for Orchestrator)
   */
  async cancelOrder(orderId, user, reason, managerPassword = null) {
    return await this.container.cancellationOrchestrator.execute(orderId, user, {
      reason,
      managerPassword,
      source: user?.role === 'customer' ? 'CUSTOMER_CANCEL' : 'ADMIN_CANCEL'
    });
  }

  // Removed internal cancellation methods - logic moved to CancellationOrchestrator

  /**
   * ✅ Approve a pending cancellation request
   */
  async approveCancellation(orderId, user) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { cancellation: true }
    });

    if (!order || !order.cancellation) throw new Error('CANCELLATION_NOT_FOUND');
    if (order.cancellation.status !== 'pending') throw new Error('CANCELLATION_ALREADY_PROCESSED');

    // 🔐 Permission Check
    const isAdmin = user?.role === 'admin';
    const isManager = user?.role?.toUpperCase() === 'BRANCH_MANAGER';

    if (isManager) {
      if (order.status === 'waiting_cancellation_admin') throw new Error('ADMIN_APPROVAL_REQUIRED');
    }

    if (!isAdmin && !isManager) throw new Error('UNAUTHORIZED');

    return await this.container.cancellationOrchestrator.execute(orderId, user, {
      reason: order.cancellation.reason,
      source: 'ADMIN_APPROVAL',
      skipPasswordCheck: true
    });
  }

  /**
   * ❌ Reject a pending cancellation request
   */
  async rejectCancellation(orderId, user, rejectionReason) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { cancellation: true }
    });

    if (!order || !order.cancellation) throw new Error('CANCELLATION_NOT_FOUND');
    
    // Role & Branch Check
    if (user.role?.toUpperCase() === 'BRANCH_MANAGER' && order.branchId !== user.branchId) {
      throw new Error('ORDER_FORBIDDEN');
    }

    const previousStatus = order.cancellation.previousStatus || 'pending';

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: order.id, version: order.version },
        data: { 
          status: previousStatus,
          version: { increment: 1 } 
        },
        include: ORDER_INCLUDE_FULL
      });

      await tx.orderCancellation.update({
        where: { id: order.cancellation.id },
        data: { 
          status: 'rejected', 
          rejectionReason, 
          adminName: user?.email || 'Admin' 
        }
      });

      return updated;
    }, { timeout: 15000 });

    const EventBus = require('../events/eventBus');
    EventBus.publish({ type: 'order.cancellation_rejected', payload: { order: updatedOrder, user, rejectionReason } });

    return mapOrderResponse(updatedOrder);
  }

  /**
   * 🏗️ Enterprise Order Creation (Hardened v2)
   * Full transactional logic with Defense-in-Depth security.
   * Security Layers:
   * 1. Ghost Order Protection
   * 2. Guest Order Type Restriction
   * 3. Service-Level Branch Authorization (independent of middleware)
   * 4. Branch Existence & Active Status Re-verification
   * 5. Audit Logging for suspicious attempts
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

    // 🔴 الحظر الصارم للضيوف: فرض تسجيل الدخول الإلزامي للطلبات
    if (!authUser || !authUser.id) {
      throw new Error('AUTH_REQUIRED: Guests are not allowed to place orders. Please login.');
    }

    const phoneInput = data.phone || customerPhone;

    // 1. 🆔 Identity & Blacklist Resolution
    const resolvedCustomer = await this._resolveAndValidateCustomer(phoneInput, authUser);

    this.logger.info(`[OrderService] Creating Order. AuthUser: ${authUser?.id}, InputPhone: ${phoneInput}, ResolvedCustomer: ${resolvedCustomer.id}`);

    // 0. Fetch Dynamic Business Policies
    const config = await configService.getFullConfig();
    const prepTime = Math.max(1, parseInt(config.business?.slaPrepTimeMinutes) || 30);
    const peakMult = Math.max(0.1, parseFloat(config.business?.peakMultiplier) || 1.0);
    const deliveryTime = Math.max(1, parseInt(config.business?.slaDeliveryTimeMinutes) || 30);
    const totalPrepMinutes = Math.round(prepTime * peakMult);

    // 1. 🛡️ Canonical Branch Resolution (Security Boundary)
    const targetBranchId = await this._resolveBranchId(data.branchId || data.branch, authUser?.id);

    // 1.6 🛡️ [DEFENSE-IN-DEPTH] Service-Level Branch Authorization
    // This check runs INSIDE the service, independent of any middleware.
    // Prevents unauthorized access even if called from internal code paths.
    if (authUser) {
      const role = authUser.role?.toLowerCase();
      
      // Managers/Branch Managers: Must have explicit branch access
      if (['manager', 'branch_manager'].includes(role)) {
        const SecurityPolicyService = require('./securityPolicyService');
        const hasAccess = await this.container.securityPolicyService.canAccessBranch(authUser, targetBranchId, 'write');
        
        if (!hasAccess) {
          // 🚨 CRITICAL: Log unauthorized attempt
          const auditService = require('./auditService');
          await this.container.auditService.log({
            userId: authUser.id,
            userRole: role,
            action: 'SERVICE_LAYER_BRANCH_ACCESS_DENIED',
            entityType: 'Order',
            status: 'BLOCKED',
            severity: 'CRITICAL',
            metadata: {
              targetBranchId,
              userBranchId: authUser.branchId,
              source: 'orderService.createOrder'
            }
          });
          
          throw new Error('BRANCH_ACCESS_DENIED');
        }
      }
    }

    // [V3 SECURITY-FIX] Branch Operational Validation moved INSIDE transaction to prevent race conditions.

    // 2. 🛡️ Spam Protection (Multi-factor)
    await this._validateSpamLimits(resolvedCustomer.phone);


    // 3. 💰 Pricing & Inventory Validation (Branch-Aware)
    const { validatedItems, subtotal } = await this._calculateAndValidatePricing(cartItems, targetBranchId);

    // 4. 🚚 Delivery & Region Validation
    const deliveryDetails = await this._validateDeliveryDetails(orderType, deliveryZoneId, subtotal);

    // 5. 🔢 Generate Atomic Order Number
    const orderNumber = await this._generateOrderNumber();

    // 5.5 🎁 Points Redemption Logic (Unified via Pricing Engine)
    let pointsDiscount = 0;
    let pointsToDeduct = 0;

    if (data.usePoints === true) {
      const loyaltyConfig = await this.container.loyaltyService.getConfig();
      const pricingService = require('./pricingService');
      
      const redemption = pricingService.calculatePointsRedemption(
        resolvedCustomer.points, 
        subtotal, 
        loyaltyConfig
      );

      pointsDiscount = redemption.discount.toNumber();
      pointsToDeduct = redemption.pointsToDeduct;

      // 🛡️ [SAFETY GUARD] Verify expected discount from client
      if (data.expectedDiscount && Math.abs(pointsDiscount - data.expectedDiscount) > 0.01) {
        this.logger.warn(`[OrderService] Discount mismatch for order ${orderNumber}: App expected ${data.expectedDiscount}, Server calculated ${pointsDiscount}`);
      }
    }

    // 🛡️ Pricing Logic: Unify via Canonical Pricing Engine
    const pricingService = require('./pricingService');
    const systemConfig = await configService.getFullConfig();
    const financials = pricingService.calculateOrderTotals(
      validatedItems, 
      deliveryDetails.fee, 
      pointsDiscount,
      systemConfig.business.taxRate
    );


    // 🚀 Auto Accept Orders Logic
    let sysSettings = memoryCache.get('system:settings');
    if (!sysSettings) {
      const redisSettings = await this.redis.get('system:settings');
      if (redisSettings) sysSettings = safeJsonParse(redisSettings);
      else {
        const dbSetting = await this.prisma.systemSettings.findUnique({ where: { key: 'autoAcceptOrders' } });
        sysSettings = { autoAcceptOrders: dbSetting?.value === 'true' };
      }
    }
    const isAutoAccept = sysSettings?.autoAcceptOrders === true || sysSettings?.autoAcceptOrders === 'true';
    const initialStatus = isAutoAccept ? 'preparing' : 'pending';

    // 6. 💎 Atomic Transactional Persistence
    const { newOrder } = await this.prisma.$transaction(async (tx) => {
      // 🛡️ [V3 SECURITY-FIX] Transactional Operational Check
      const branchStatus = await tx.branch.findUnique({
        where: { id: targetBranchId },
        select: { 
          isActive: true, 
          name: true 
        }
      });

      if (!branchStatus || !branchStatus.isActive) {
        throw new Error(`BRANCH_NOT_OPERATIONAL: ${branchStatus?.name || 'Unknown'}`);
      }

      const order = await tx.order.create({
        data: {
          orderNumber,
          customerName: encrypt(customerName || 'زبون'),
          customerNameHash: hashBlind(customerName || 'زبون'),
          customerPhone: encrypt(resolvedCustomer.phone),
          customerPhoneHash: hashBlind(resolvedCustomer.phone),
          customerId: resolvedCustomer.id,
          orderType: orderType || 'takeaway',
          paymentMethod: paymentMethod || 'cash',
          subtotal: financials.subtotal,
          tax: financials.tax,
          deliveryFee: financials.deliveryFee,
          discount: financials.discount, // 🛡️ [BUG-01 FIX] Persist discount in order table
          total: financials.total,
          status: initialStatus,
          source: (authUser && authUser.role === 'admin') ? 'manual' : 'app',
          address: address ? xss(address) : address,
          notes: notes ? xss(notes) : notes,
          branchId: targetBranchId,
          deliveryZoneId: deliveryDetails.zoneId,
          deliveryZoneName: deliveryDetails.zoneName,
          deliveryMinOrder: deliveryDetails.minOrder,
          preparationTimeMinutes: totalPrepMinutes,
          deliveryTimeMinutes: deliveryTime,
          estimatedReadyAt: new Date(Date.now() + totalPrepMinutes * 60000),
          estimatedArrivalAt: new Date(Date.now() + (totalPrepMinutes + deliveryTime) * 60000),
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
        await this.container.loyaltyLedgerService.debit(
          resolvedCustomer.id,
          pointsToDeduct,
          'REDEMPTION',
          order.id,
          `استخدام نقاط في الطلب #${order.orderNumber}`,
          `order:redeem:${order.id}`,
          { orderNumber: order.orderNumber },
          tx
        );

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

        await this.container.ledgerService.record(tx, {
          customerId: resolvedCustomer.id,
          orderId: order.id,
          type: 'DEBIT',
          category: 'ORDER_PAYMENT',
          amount: pointsDiscount,
          method: 'POINTS',
          description: `خصم نقاط: تم تحويل ${pointsToDeduct} نقطة إلى ${pointsDiscount} د.أ كخصم للطلب #${order.orderNumber}`,
          metadata: { 
            pointsBefore: resolvedCustomer.points,
            pointsAfter: resolvedCustomer.points - pointsToDeduct,
            pointsDeducted: pointsToDeduct 
          }
        });
      }

      // 💳 [WALLET CHECKOUT FIX] Deduct order total from customer's wallet if paid by wallet
      if (paymentMethod === 'wallet' && financials.total > 0) {
        await this.container.walletService.debit(
          resolvedCustomer.id,
          financials.total,
          'ORDER_PAYMENT',
          order.id.toString(),
          `Payment for order #${order.orderNumber}`,
          `order_wallet_debit:${order.id}`,
          tx
        );
      }

      const mappedForEvent = mapOrderResponse(order);
      await publishEvent({
        type: eventTypes.ORDER_CREATED,
        aggregateId: mappedForEvent.id,
        payload: {
          order: {
            ...mappedForEvent,
            id: order.id,
            customerId: order.customerId,
            customerPhone: order.customer?.phone || null,
            customer: order.customer
          }
        },
        version: 1,
        tenantId: mappedForEvent.tenantId,
        metadata: { aggregateType: 'Order', tx }
      });

      return { newOrder: order };
    }, { timeout: 20000 });

    // 🔄 [PHASE 4] Sync Projection after commit if points were deducted
    if (pointsToDeduct > 0) {
      const finalCustomer = await this.prisma.customer.findUnique({ 
        where: { id: resolvedCustomer.id },
        select: { points: true }
      });
      if (finalCustomer) {
        await this.container.loyaltyLedgerService.syncProjection(resolvedCustomer.id, finalCustomer.points);
      }
    }

    // 7. 🚀 Async Side Effects (Non-blocking)
    this._triggerPostOrderEffects(newOrder);

    // 💓 Wake up Outbox Dispatcher instantly outside the database transaction
    setImmediate(() => {
      if (this.container && this.container.outboxService) {
        this.container.outboxService.pulse().catch(() => {});
      }
    });

    const mappedOrder = mapOrderResponse(newOrder);

    // ⚡ [PHASE 2] Live Cache Sync
    await liveCacheService.cacheOrder(newOrder).catch(err =>
      this.logger.error('[CacheSync] Non-fatal cache write failed', { error: err.message })
    );

    // ⏲️ [PHASE 2] Automated Lifecycle Timeout (15 Mins)
    await orderQueue.add('auto-timeout', { orderId: newOrder.id, type: 'PENDING_TIMEOUT' }, {
      delay: (config.business.autoCancelTimeoutMinutes || 15) * 60 * 1000,
      jobId: `timeout_${newOrder.id}`,
      removeOnComplete: true
    }).catch(err =>
      this.logger.error('[OrderQueue] Non-fatal queue schedule failed', { error: err.message })
    );

    return mappedOrder;
  }

  /**
   * 🛡️ Spam Guard: Checks recent cancellations and blacklists if necessary.
   */
  async _validateSpamLimits(phone) {
    // 🛡️ 3-Tier Fallback for Settings
    let settings = memoryCache.get('system:settings');

    if (!settings) {
      const redisSettings = await this.redis.get('system:settings');
      if (redisSettings) {
        settings = safeJsonParse(redisSettings);
        memoryCache.set('system:settings', settings, 300); // 5 mins
      } else {
        settings = await this.prisma.systemSettings.findFirst();
        if (settings) {
          await this.redis.set('system:settings', JSON.stringify(settings), 'EX', 3600);
          memoryCache.set('system:settings', settings, 300);
        }
      }
    }

    const limit = settings?.spamCancelLimit ?? 3;
    const window = settings?.spamTimeWindowMinutes ?? 30;
    const since = new Date(Date.now() - window * 60 * 1000);

    const count = await this.prisma.orderCancellation.count({
      where: {
        order: { customerPhoneHash: hashBlind(phone) },
        createdAt: { gte: since },
      },
    });

    if (count >= limit) {
      const expires = new Date(Date.now() + window * 60 * 1000);
      await this.prisma.customer.update({
        where: { phoneHash: hashBlind(phone) },
        data: {
          isBlacklisted: true,
          blacklistExpiresAt: expires,
          blacklistReason: `Spam detected: ${count} cancellations in ${window}m`
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
      customer = await this.prisma.customer.findUnique({ 
        where: { uuid: authUser.id },
        select: { id: true, phone: true, points: true, walletBalance: true, isBlacklisted: true, blacklistExpiresAt: true }
      });
      if (customer) {
        resolvedPhone = decrypt(customer.phone);
        this.logger.debug(`[OrderService] Found customer by UUID ${authUser.id}: ID ${customer.id}`);
      } else {
        this.logger.debug(`[OrderService] No customer found for UUID ${authUser.id}. User role: ${authUser.role}`);
        // If it's an admin, we allow fallback to phone (for manual orders)
        // If it's a customer but UUID not found (stale token), we should NOT fallback to another customer's phone
        if (authUser.role !== 'admin') {
          this.logger.warn(`[OrderService] Authenticated customer UUID not found. Blocking fallback to prevent misattribution.`);
          return { id: null, phone: phone, points: 0, walletBalance: 0 }; // Treat as Guest instead of linking to wrong ID
        }
      }
    }

    if (!customer && resolvedPhone) {
      customer = await this.prisma.customer.findUnique({ 
        where: { phoneHash: hashBlind(resolvedPhone) },
        select: { id: true, phone: true, points: true, walletBalance: true, isBlacklisted: true, blacklistExpiresAt: true }
      });
      if (customer) {
        this.logger.debug(`[OrderService] Found customer by Phone ${resolvedPhone}: ID ${customer.id}`);
      } else {
        this.logger.debug(`[OrderService] No customer found for Phone ${resolvedPhone}`);
      }
    }

    if (customer?.isBlacklisted) {
      if (customer.blacklistExpiresAt && customer.blacklistExpiresAt < new Date()) {
        customer = await this.prisma.customer.update({
          where: { id: customer.id },
          data: { isBlacklisted: false, blacklistExpiresAt: null }
        });
      } else {
        throw new Error('CUSTOMER_BLACKLISTED');
      }
    }

    return {
      id: customer?.id || null,
      phone: resolvedPhone,
      points: customer?.points || 0,
      walletBalance: customer?.walletBalance || 0
    };
  }

  /**
   * 🛡️ Canonical Branch Resolver (Enterprise Guard)
   * Exclusively accepts UUIDs. Enforces strict identity and operational safety.
   */
  async _resolveBranchId(input, userId = 'guest') {
    if (!input || typeof input !== 'string') {
      throw new Error('BRANCH_ID_REQUIRED');
    }

    let targetId = input.trim();

    // 1. 🛡️ Check if input is a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(targetId)) {
      // Intelligently lookup branch by code or name to provide absolute client compatibility
      const resolved = await this.prisma.branch.findFirst({
        where: {
          isDeleted: false,
          OR: [
            { code: { equals: targetId.toUpperCase() } },
            { name: { contains: targetId } }
          ]
        },
        select: { id: true }
      });

      if (!resolved) {
        await this._logInvalidBranchAttempt(userId, targetId, 'INVALID_FORMAT_OR_CODE');
        throw new Error('INVALID_BRANCH_IDENTIFIER: Target branch code or name not found.');
      }
      targetId = resolved.id;
    }

    // 2. 🛡️ Registry Validation: Check existence in Canonical Registry
    const branch = await this.prisma.branch.findFirst({ 
      where: { id: targetId, isDeleted: false }, 
      select: { id: true, isActive: true } 
    });

    if (!branch || !branch.isActive) {
      await this._logInvalidBranchAttempt(userId, targetId, 'NOT_FOUND');
      throw new Error('BRANCH_NOT_FOUND: The targeted identity does not exist or is inactive.');
    }

    return branch.id;
  }

  /**
   * 🕵️ Security Audit: Log and Detect Branch Enumeration Attacks
   */
  async _logInvalidBranchAttempt(userId, providedId, reason) {
    const redisCache = require('../lib/redis').cache;
    const key = `sec:branch_enum:${userId}`;
    
    try {
      // Increment anomaly counter
      const count = await redisCache.incr(key);
      if (count === 1) await redisCache.expire(key, 3600); // 1-hour window

      this.logger.warn('INVALID_BRANCH_TARGET_ATTEMPT', { 
        userId, 
        providedId, 
        reason, 
        anomalyScore: count 
      });

      if (count > 10) {
        this.logger.error('BRANCH_ENUMERATION_DETECTED', { userId, count });
      }
    } catch (err) {
      this.logger.error('[BranchEnumAudit] Failed to log anomaly', { error: err.message });
    }
  }

  /**
   * 💰 Calculation Engine: Re-verifies all prices from DB to prevent client-side manipulation.
   */
  async _calculateAndValidatePricing(cartItems, branchId = null) {
    this.logger.info(`[Pricing] Validating ${cartItems?.length} items for branch: ${branchId}`);
    let subtotal = 0;
    const validatedItems = [];

    if (!cartItems || cartItems.length === 0) {
      return { validatedItems, subtotal };
    }

    // 1. Batch extract unique item IDs and option IDs flexibly supporting multiple client format standards
    const itemIds = [...new Set(cartItems.map(item => parseInt(item.productId || item.id)).filter(id => !isNaN(id)))];
    const extractOptIds = (itm) => {
      const arr = itm.optionIds || itm.modifierIds || itm.options || itm.modifiers || [];
      return arr.map(o => parseInt(typeof o === 'object' && o !== null ? o.id : o)).filter(id => !isNaN(id));
    };
    const allOptionIds = [...new Set(cartItems.flatMap(extractOptIds))];

    // 2. Execute parallel/batch fetching to eliminate N+1 queries
    const [dbItemsArray, dbOptionsArray] = await Promise.all([
      this.prisma.item.findMany({
        where: { id: { in: itemIds } },
        include: { 
          variants: true, // 🛡️ Fully support sizes/variants integration
          modifierGroups: { 
            where: { isActive: true },
            include: { modifiers: { where: { isAvailable: true } } } 
          },
          branchItems: branchId ? {
            where: { branchId: branchId },
            select: { isAvailable: true, stockCount: true }
          } : false
        }
      }),
      allOptionIds.length > 0 
        ? this.prisma.itemModifier.findMany({
            where: { id: { in: allOptionIds } },
            include: { group: true }
          })
        : Promise.resolve([])
    ]);

    // 3. Create O(1) in-memory lookup maps
    const dbItemsMap = new Map(dbItemsArray.map(item => [item.id, item]));
    const dbOptionsMap = new Map(dbOptionsArray.map(opt => [opt.id, opt]));

    // 4. Validate items sequentially in memory
    for (const item of cartItems) {
      const targetId = parseInt(item.productId || item.id);
      const dbItem = dbItemsMap.get(targetId);

      if (!dbItem) throw new Error(`ITEM_NOT_FOUND:${item.id}`);

      // 🛡️ [BRANCH-ISOLATION] Strict Check
      if (branchId) {
        if (!dbItem.branchItems || dbItem.branchItems.length === 0) {
          throw new Error(`ITEM_NOT_IN_BRANCH:${dbItem.title}`);
        }
        
        // Branch-specific availability override
        const branchAvailability = dbItem.branchItems[0].isAvailable;
        if (!branchAvailability) throw new Error(`ITEM_UNAVAILABLE_IN_BRANCH:${dbItem.title}`);

        // 🛡️ [STOCK-VALIDATION] Check stock count against requested quantity
        const stockCount = dbItem.branchItems[0].stockCount;
        const requestedQty = parseInt(item.quantity) || 1;
        if (stockCount >= 0 && stockCount < requestedQty) {
          throw new Error(`INSUFFICIENT_STOCK:${dbItem.title}:requested=${requestedQty}:available=${stockCount}`);
        }
      } else {
        // Global availability fallback (if no branch context)
        if (!dbItem.isAvailable) throw new Error(`ITEM_UNAVAILABLE:${dbItem.title}`);
      }

      let unitPrice = toNumber(dbItem.basePrice);
      const incomingOptionIds = extractOptIds(item);
      
      // Track which groups are already covered by incoming options
      const coveredGroupIds = new Set();
      const validatedOptionIds = [];
      const validatedOptionNames = [];
      const validatedOptionNamesEn = [];

      // 0. Process Variant/Size Selection if present
      const targetVariantId = parseInt(item.variantId || item.selectedVariantId || item.variant?.id || item.variant);
      let selectedVariant = null;
      if (!isNaN(targetVariantId)) {
        selectedVariant = dbItem.variants?.find(v => v.id === targetVariantId);
      } else if (item.variant && typeof item.variant === 'string') {
        selectedVariant = dbItem.variants?.find(v => v.name.toLowerCase() === item.variant.toLowerCase());
      } else if (item.size && typeof item.size === 'string') {
        selectedVariant = dbItem.variants?.find(v => v.name.toLowerCase() === item.size.toLowerCase());
      }

      if (selectedVariant) {
        unitPrice += toNumber(selectedVariant.priceDiff);
        validatedOptionNames.push(selectedVariant.name);
        if (selectedVariant.nameEn) validatedOptionNamesEn.push(selectedVariant.nameEn);
      }

      // 1. Process client-provided options from pre-fetched map
      if (incomingOptionIds.length > 0) {
        for (const optId of incomingOptionIds) {
          const opt = dbOptionsMap.get(optId);
          if (!opt || opt.group?.itemId !== dbItem.id) continue; // Security: Ensure option belongs to item
          unitPrice += toNumber(opt.price);
          coveredGroupIds.add(opt.groupId);
          validatedOptionIds.push(opt.id);
          validatedOptionNames.push(opt.name);
          if (opt.nameEn) validatedOptionNamesEn.push(opt.nameEn);
        }
      }

      // 2. 🛡️ Self-Healing: Fill gaps for REQUIRED groups that were NOT provided
      const optionGroups = dbItem.modifierGroups || dbItem.optionGroups || [];
      for (const group of optionGroups) {
        if (group.isRequired && !coveredGroupIds.has(group.id)) {
          // Find default option, or fallback to first available
          const options = group.modifiers || group.options || [];
          const fallbackOpt = options.find(o => o.isDefault) || options[0];
          if (fallbackOpt) {
            this.logger.warn(`[Pricing] Auto-applying default option ${fallbackOpt.name} for required group ${group.groupName} on item ${dbItem.title}`);
            unitPrice += toNumber(fallbackOpt.price);
            validatedOptionIds.push(fallbackOpt.id);
            validatedOptionNames.push(fallbackOpt.name);
            if (fallbackOpt.nameEn) validatedOptionNamesEn.push(fallbackOpt.nameEn);
          }
        }
      }

      const qty = parseInt(item.quantity);
      if (isNaN(qty) || qty <= 0) throw new Error(`INVALID_QUANTITY:${dbItem.title}`);

      const lineTotal = toMoney(unitPrice * qty);
      subtotal += lineTotal;

      // Construct final options text dynamically ensuring variant/size and modifiers are properly visible
      const finalOptionsText = validatedOptionNames.length > 0 ? validatedOptionNames.join(', ') : (item.optionsText || null);
      const finalOptionsTextEn = validatedOptionNamesEn.length > 0 ? validatedOptionNamesEn.join(', ') : (item.optionsTextEn || null);

      const itemNotes = item.note || item.notes || null;
      validatedItems.push({
        itemId: dbItem.id,
        itemName: dbItem.title,
        itemNameEn: dbItem.titleEn || dbItem.title,
        quantity: qty,
        unitPrice,
        lineTotal,
        selectedOptions: finalOptionsText,
        selectedOptionsEn: finalOptionsTextEn,
        notes: itemNotes ? xss(itemNotes) : null
      });
    }

    return { validatedItems, subtotal };
  }

  /**
   * 🚚 Delivery Logic: Ensures fee and min-order constraints are met.
   */
  async _validateDeliveryDetails(type, zoneId, subtotal) {
    if (type !== 'delivery') return { fee: 0, zoneId: null, zoneName: null, minOrder: 0, peakApplied: false };

    const config = await configService.getFullConfig();
    const peakMultiplier = config.business.peakMultiplier || 1.0;

    if (!zoneId) {
      const baseFee = toNumber(config.business.defaultDeliveryFee, 1);
      const adjustedFee = Math.round(baseFee * peakMultiplier * 100) / 100;
      return { fee: adjustedFee, zoneId: null, zoneName: 'Default', minOrder: 0, peakApplied: peakMultiplier > 1.0 };
    }

    const zone = await this.prisma.deliveryZone.findUnique({ where: { id: zoneId } });
    if (!zone || !zone.isActive) throw new Error('INVALID_DELIVERY_ZONE');

    const baseFee = toNumber(zone.fee);
    const adjustedFee = Math.round(baseFee * peakMultiplier * 100) / 100;
    const minOrder = toNumber(zone.minOrder);

    if (minOrder > 0 && subtotal < minOrder) {
      throw new Error(`MIN_ORDER_NOT_MET:${minOrder}`);
    }

    return {
      fee: adjustedFee,
      zoneId: zone.id,
      zoneName: zone.nameAr,
      minOrder,
      peakApplied: peakMultiplier > 1.0
    };
  }

  /**
   * 🔢 Generate Unique Atomic Order Number (ORD-YYYYMMDD-XXXX)
   */
  async _generateOrderNumber() {
    try {
      const result = await this.prisma.$queryRaw`SELECT nextval('order_number_seq') as next_val`;
      if (result && result[0] && result[0].next_val) {
        const seqNum = result[0].next_val.toString();
        const year = new Date().getFullYear();
        return `AMM-${year}-${seqNum}`;
      }
    } catch (err) {
      this.logger.error('[OrderNumber] Sequence query failed, falling back to Redis', { error: err.message });
    }

    // Fallback: Daily Redis increment
    const { DEFAULT_TIMEZONE } = require('../config/constants');
    const { DateTime } = require('luxon');
    const dateStr = DateTime.now().setZone(DEFAULT_TIMEZONE).toFormat('yyyyMMdd');
    const counterKey = `order_counter:${dateStr}`;
    const serialNumber = await this.redis.incr(counterKey);

    if (serialNumber === 1) await this.redis.expire(counterKey, 172800);

    const serial = serialNumber.toString().padStart(4, '0');
    return `AMM-${dateStr}-${serial}-FB`;
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
        this.logger.error('[OrderService] Failed to enqueue autoAccept job', { orderId: order.id, error: err.message });
      });

      // 3. Analytics Pulse
      this.container.analyticsService.updateCacheIncrementally({
        type: 'ORDER_CREATED',
        amount: toNumber(order.total),
        orderNumber: order.orderNumber,
        action: 'طلب جديد',
        user: order.customerName
      });

      // 4. 💎 Loyalty Hook moved to delivered status

    } catch (err) {
      this.logger.error('Post-order effects error', { orderId: order.id, error: err.message });
    }
  }

  /**
   * 🎁 Loyalty & Rewards Hook (Placeholder)
   * Defered as per Business Design Cycle.
   */
  async _onOrderCompleted(orderId) {
    try {
      const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });
      const points = await this.container.loyaltyService.calculatePointsForOrder(order);
      if (points > 0) {
        await this.container.outboxService.enqueue(prisma, {
          type: 'loyalty.order_award',
          aggregateId: order.id,
          aggregateType: 'Order',
          payload: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerId: order.customerId,
            points
          }
        });
      }
    } catch (err) {
      this.logger.error('[Loyalty] Failed to enqueue points on completion', { orderId, error: err.message });
    }
  }

  /**
   * ⚡ Atomic Status Update & State Machine Validation
   */
  async updateOrderStatus(orderId, newStatus, version = null, user = null) {
    let attempts = 0;
    const maxRetries = 3;

    while (attempts < maxRetries) {
      try {
        const order = await this.prisma.order.findUnique({
          where: { id: orderId },
          include: { customer: true }
        });

        if (!order) return null;

        if (order.status === newStatus) return mapOrderResponse(order);

        // 🛡️ [SEC-FIX] Optimistic Locking Validation
        if (version !== null && version !== undefined && order.version !== parseInt(version)) {
          throw new Error('CONCURRENCY_CONFLICT');
        }

        const previousStatus = order.status;
        const currentVersion = order.version;

        // 🛡️ [SEC-FIX] State Machine Validation
        validateTransition(previousStatus, newStatus, orderId, this.container.auditService, user);

        const { updatedOrder, _outboxId } = await this.prisma.$transaction(async (tx) => {
          const { count } = await tx.order.updateMany({
            where: { id: order.id, version: currentVersion },
            data: { 
              status: newStatus, 
              version: { increment: 1 }, 
              eventSequence: { increment: 1 },
              previousVersion: currentVersion,
              causedByEventId: user?.eventId || null 
            }
          });

          if (count === 0) {
            throw new Error('CONCURRENCY_CONFLICT');
          }

          // Fetch authoritative updated state inside the same tx
          const updated = await tx.order.findUnique({
            where: { id: order.id },
            include: ORDER_INCLUDE_FULL
          });

          if (!updated) {
            throw new Error('ORDER_NOT_FOUND');
          }

          // 🎁 Loyalty Reward Hook
          if (newStatus === 'delivered') {
            const pointsEarned = await this.container.loyaltyService.calculatePointsForOrder(updated);
            if (pointsEarned > 0) {
              await this.container.outboxService.enqueue(tx, {
                type: 'loyalty.order_award',
                aggregateId: updated.id,
                aggregateType: 'Order',
                payload: {
                  orderId: updated.id,
                  orderNumber: updated.orderNumber,
                  customerId: updated.customerId,
                  points: pointsEarned
                }
              });
            }

            // 🎟️ Referral System Hook: Award points if this is the customer's first delivered order
            if (updated.customerId) {
              const dbCustomer = await tx.customer.findUnique({
                where: { id: updated.customerId },
                select: { referredById: true }
              });
              
              if (dbCustomer && dbCustomer.referredById) {
                const previousDeliveredOrdersCount = await tx.order.count({
                  where: {
                    customerId: updated.customerId,
                    status: 'delivered',
                    id: { not: updated.id }
                  }
                });
                
                if (previousDeliveredOrdersCount === 0) {
                  const referralPoints = await this.container.loyaltyService.calculateEngagementPoints('REFERRAL');
                  await this.container.outboxService.enqueue(tx, {
                    type: 'loyalty.referral_award',
                    aggregateId: String(dbCustomer.referredById),
                    aggregateType: 'Customer',
                    payload: {
                      referredCustomerId: updated.customerId,
                      referrerCustomerId: dbCustomer.referredById,
                      points: referralPoints,
                      orderId: updated.id
                    }
                  });
                  this.logger.info(`[OrderService] Enqueued referral reward for referrer Customer #${dbCustomer.referredById} due to Customer #${updated.customerId} first order`);
                }
              }
            }
          }

          // 📮 Authoritative Event Publication (Transactional Outbox)
          const outbox = await this.container.eventPublisher.publishEvent({
            type: 'ORDER_STATUS_CHANGED',
            aggregateId: updated.id,
            version: updated.version,
            eventSequence: updated.eventSequence,
            previousVersion: currentVersion,
            causationId: user?.eventId || null,
            payload: {
              previousStatus,
              newStatus,
              order: mapOrderResponse(updated)
            },
            metadata: { aggregateType: 'Order', tx } // 🛡️ Level 2: Atomic Persistence
          });

          return { updatedOrder: updated, _outboxId: outbox.id };
        }, { timeout: 15000 });

        // 💓 SDS 2.0 Wake-up Pulse: Trigger immediate background distribution
        await this.container.outboxService.pulse();

        const mappedOrder = mapOrderResponse(updatedOrder);

        // 📊 Incremental Analytics Update
        this.container.analyticsService.updateCacheIncrementally({
          type: 'ORDER_STATUS_CHANGE',
          amount: toNumber(updatedOrder.total),
          status: newStatus,
          previousStatus,
          orderNumber: updatedOrder.orderNumber
        });

        // ⚡ Sync Protocol: Bump branch version
        await this.bumpBranchVersion(updatedOrder.branchId);

        return { ...mappedOrder, _outboxId };

      } catch (error) {
        // 🔄 [RETRY-LOGIC] Handle Prisma concurrency errors and custom conflicts
        if ((error.code === 'P2025' || error.message === 'CONCURRENCY_CONFLICT') && attempts < maxRetries - 1) {
          attempts++;
          const delay = 100 * attempts;
          this.logger.warn(`[OrderService] Concurrency conflict detected for Order ${orderId}. Retry ${attempts}/${maxRetries} after ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // 🛡️ [UX-ENHANCEMENT] After all retries, return the ACTUAL current state instead of crashing
        if (error.code === 'P2025' || error.message === 'CONCURRENCY_CONFLICT') {
          const finalOrder = await this.prisma.order.findUnique({ 
            where: { id: orderId },
            include: ORDER_INCLUDE_FULL
          });
          
          if (finalOrder) {
            this.logger.info(`[OrderService] Conflict resolved by returning latest state for Order ${orderId}`);
            return {
              ...mapOrderResponse(finalOrder),
              _conflict: true,
              _message: 'حالة الطلب تغيرت أثناء محاولتك للتحديث، يرجى المحاولة مرة أخرى'
            };
          }
        }

        throw error;
      }
    }
  }

  async batchAcceptOrders(user) {
    const results = { accepted: 0, skipped: 0, conflicts: 0 };
    const adminEmail = user?.email || 'Admin System';

    // 🛡️ [SECURITY-UNIFICATION] Branch Isolation via Central Policy
    const SecurityPolicyService = require('./securityPolicyService');
    const branchFilter = await this.container.securityPolicyService.getHardenedFilter(user, 'Order');
    
    const where = { 
      status: 'pending', 
      isDeleted: false,
      ...branchFilter
    };

    try {
      const { accepted, skipped, processedOrders } = await this.prisma.$transaction(async (tx) => {
        let acceptedCount = 0;
        let skippedCount = 0;
        const processed = [];

        // 1. Fetch pending orders within transaction
        const pendingOrders = await tx.order.findMany({
          where,
          include: ORDER_INCLUDE_FULL,
          orderBy: { createdAt: 'asc' }
        });

        // 2. Atomic Loop Processing
        for (const order of pendingOrders) {
          try {
            const updated = await tx.order.update({
              where: { 
                id: order.id,
                version: order.version // 🛡️ Optimistic Locking
              },
              data: {
                status: 'preparing',
                version: { increment: 1 },
                updatedAt: new Date()
              },
              include: ORDER_INCLUDE_FULL
            });

            // Audit Log
            await AuditLogger.logOrderChange(tx, {
              orderId: order.id,
              eventType: 'ORDER_STATUS_CHANGE',
              eventAction: 'BATCH_ACCEPTED',
              changedBy: adminEmail,
              changedByRole: 'admin',
              previousData: { status: 'pending' },
              newData: { status: 'preparing' }
            });

            const mappedOrder = mapOrderResponse(updated);
            await publishEvent({
              type: eventTypes.ORDER_STATUS_CHANGED,
              aggregateId: mappedOrder.id,
              payload: { previousStatus: 'pending', newStatus: 'preparing', order: mappedOrder },
              version: updated.version,
              metadata: { aggregateType: 'Order', tx }
            });

            acceptedCount++;
            processed.push(updated);
          } catch (err) {
            // P2025: Record to update not found (Concurrency conflict)
            if (err.code === 'P2025') {
              skippedCount++;
              this.logger.warn(`[BatchAccept] Order ${order.id} skipped due to concurrency conflict.`);
            } else {
              throw err; // Critical failure
            }
          }
        }

        return { accepted: acceptedCount, skipped: skippedCount, processedOrders: processed };
      }); // ⏱️ Higher timeout for large batches

      results.accepted = accepted;
      results.skipped = skipped;
      results.conflicts = skipped;

      // 🚀 Background Side-Effects (Notifications, Analytics)
      if (processedOrders.length > 0) {
        setImmediate(async () => {
          // 💓 Wake up Outbox Dispatcher instantly outside the transaction block
          if (this.container && this.container.outboxService) {
            await this.container.outboxService.pulse().catch(() => {});
          }

          for (const order of processedOrders) {
            try {
              this.container.analyticsService.updateCacheIncrementally({
                type: 'ORDER_STATUS_CHANGE',
                amount: toNumber(order.total),
                status: 'preparing',
                branchId: order.branchId
              });

              await this.bumpBranchVersion(order.branchId);
            } catch (err) {
              this.logger.error(`[BatchAccept] Side-effects failed for order ${order.id}`, { error: err.message });
            }
          }
        });
      }

      return results;
    } catch (error) {
      this.logger.error('[BatchAccept] Transaction failed', { error: error.message });
      throw error;
    }
  }

  /**
   * ⭐ Submit Order Rating (Direct Order Review)
   */
  async submitOrderRating(orderId, actor, rating, comment) {
    if (!orderId) throw new Error('ORDER_NOT_FOUND');
    const ratingNum = parseInt(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      throw new Error('INVALID_RATING');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, rating: true, branchId: true, customer: { select: { uuid: true } } }
    });

    if (!order) throw new Error('ORDER_NOT_FOUND');
    
    // 1. Delivered Status Check
    if (order.status !== 'delivered') {
      throw new Error('INVALID_STATE: لا يمكن تقييم الطلب إلا بعد توصيله بنجاح');
    }

    // 2. Ownership Check
    if (actor && actor.role === 'customer' && order.customer?.uuid !== actor.id) {
      throw new Error('ORDER_FORBIDDEN');
    }

    // 3. Prevent duplicate order rating overwrites
    if (order.rating !== null) {
      throw new Error('INVALID_STATE: لقد قمت بتقييم هذا الطلب مسبقاً');
    }

    const cleanComment = comment ? xss(comment.trim()) : null;

    // Update order with rating
    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        rating: ratingNum,
        ratingComment: cleanComment,
        isRatingApproved: false // Requires admin moderation by default
      }
    });

    // Invalidate live/branch analytics cache
    await this.bumpBranchVersion(updatedOrder.branchId);

    return {
      success: true,
      message: 'تم استلام تقييمك للطلب بنجاح، شكراً لك!',
      data: {
        orderId: updatedOrder.id,
        rating: updatedOrder.rating,
        isApproved: updatedOrder.isRatingApproved
      }
    };
  }
}

// --- 🛡️ Backward Compatibility ---
const getContainer = () => require('../lib/container');
const proxy = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'OrderService') return OrderService;
    const service = getContainer().orderService;
    const val = service[prop];
    return typeof val === 'function' ? val.bind(service) : val;
  }
});

module.exports = proxy;
module.exports.OrderService = OrderService;
