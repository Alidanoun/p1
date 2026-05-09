/**
 * 🥡 Order Core Service (Refactored)
 * Purpose: Centralized business logic for all order-related operations.
 * Features: Atomic transactions, multi-factor validation, and idempotency support.
 */
const { ORDER_INCLUDE_FULL } = require('../shared/prismaConstants');
const { hashBlind } = require('../utils/crypto');
const { mapOrderResponse } = require('../mappers/order.mapper');
const { publishEvent } = require('../events/eventPublisher');
const eventTypes = require('../events/eventTypes');
const queryOptimizer = require('../utils/queryOptimizer');

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
        where,
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

    const where = { isDeleted: false };
    if (active_only === 'true') {
      where.status = { notIn: ['delivered', 'cancelled'] };
    } else if (status) {
      where.status = status;
    }

    if (search) {
      const { hashBlind } = require('../utils/crypto');
      const hashedSearch = hashBlind(search);

      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
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
    const SecurityPolicyService = require('./securityPolicyService');
    const branchId = user.branchId || user.requestedBranchId;
    
    if (!branchId) throw new Error('BRANCH_CONTEXT_REQUIRED');

    const redis = require('../lib/redis');
    const serverVersion = await redis.get(`branch_version:${branchId}`) || '0';
    
    if (clientVersion === serverVersion) {
      return { upToDate: true, version: serverVersion };
    }
    
    const syncWhere = { 
      branchId, 
      status: { notIn: ['delivered', 'cancelled'] },
      isDeleted: false 
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
  async requestPartialCancel(orderId, items, reason, metadata = {}) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });

    if (!order) throw new Error('ORDER_NOT_FOUND');

    await this.prisma.notification.create({
      data: {
        title: 'طلب إلغاء جزئي ⚠️',
        message: `طلب تعديل للطلب #${order.orderNumber} من ${order.customerName}\nالمبلغ المسترد المتوقع: ${metadata.refundAmount || 0}`,
        type: 'partial_cancel_requested',
        orderId: order.id,
        targetRoute: `/orders?id=${order.id}`,
        metadata: JSON.stringify({
          items: items.map(i => (typeof i === 'number' ? i : i.id)),
          reason,
          refundAmount: metadata.refundAmount,
          requestedBy: metadata.requestedBy,
          requestedAt: metadata.requestedAt
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
  async applyPartialCancellation(orderId, itemIdsToCancel, actor, notificationId) {
    const { toNumber } = require('../utils/number');
    
    return await this.prisma.$transaction(async (tx) => {
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

      // 3. Recalculate Total
      let newSubtotal = 0;
      itemsToKeep.forEach(item => {
        newSubtotal += toNumber(item.unitPrice) * item.quantity;
      });

      const deliveryFee = toNumber(order.deliveryFee);
      const newTotal = newSubtotal + deliveryFee;
      const refundAmount = toNumber(order.totalAmount) - newTotal;

      // 4. Update Database
      const updatedOrder = await tx.order.update({
        where: { id: orderId, version: order.version },
        data: {
          totalAmount: newTotal,
          subtotal: newSubtotal,
          version: { increment: 1 },
          orderItems: {
            deleteMany: {
              id: { in: itemIdsToCancel }
            }
          }
        },
        include: { orderItems: true, customer: true }
      });

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
            oldTotal: order.totalAmount,
            newTotal
          })
        }
      });

      // 7. Notify Customer
      const notificationService = require('./notificationService');
      await this.container.notificationService.sendToUser(order.customerId, {
        title: 'تعديل طلبك بنجاح ✅',
        message: `تمت الموافقة على تعديل الطلب #${order.orderNumber}. المبلغ المسترد: ${refundAmount.toFixed(2)}`,
        type: 'order_adjusted',
        orderId: order.id
      });

      return {
        success: true,
        order: updatedOrder,
        refundAmount
      };
    }, { timeout: 15000 });
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
      where: { id: orderId },
      data: { rating, ratingComment: comment, isRatingApproved: false },
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
  async handleCancellationRequest(orderId, user, action, rejectionReason, externalTx = null, approvalId = null) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { cancellation: true, customer: true }
    });

    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.status !== 'waiting_cancellation' && order.status !== 'waiting_cancellation_admin') {
      throw new Error('NOT_PENDING_CANCELLATION');
    }

    if (action === 'approve') {
      const executeApproval = async (tx) => {
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
            tx,
            approvalId
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
        const outbox = await this.container.outboxService.enqueue(eventTypes.ORDER_STATUS_CHANGED, resultData, tx);

        return { updatedOrder: updated, _outboxId: outbox.id };
      };

      const result = externalTx ? await executeApproval(externalTx) : await this.prisma.$transaction(executeApproval, { timeout: 15000 });

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
   * 🎯 Fetch Unique Order with Details
   */
  async getOrderById(orderId, user = null) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        ...ORDER_INCLUDE_FULL,
        auditLogs: { orderBy: { createdAt: 'desc' }, take: 10 }
      }
    });

    if (!order) return null;

    // 🛡️ [SECURITY-UNIFICATION] Use Central Policy
    const SecurityPolicyService = require('./securityPolicyService');
    const hasAccess = await this.container.securityPolicyService.canAccessBranch(user, order.branchId);
    
    if (!hasAccess) {
      // For customers, specifically check if they own the order
      if (user.role === 'customer') {
        const customer = await this.prisma.customer.findUnique({ where: { uuid: user.id }, select: { id: true } });
        if (!customer || order.customerId !== customer.id) {
          throw new Error('ORDER_FORBIDDEN');
        }
      } else {
        throw new Error('ORDER_FORBIDDEN');
      }
    }

    return mapOrderResponse(order);
  }

  /**
   * 🛑 Cancel Order with Multi-tier Validation (Cancellation Engine v2)
   */
  async cancelOrder(orderId, user, reason) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, cancellation: true }
    });

    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.status === 'cancelled') throw new Error('ORDER_ALREADY_CANCELLED');
    if (order.cancellation && order.cancellation.status === 'pending') throw new Error('CANCELLATION_ALREADY_REQUESTED');

    // 1. Role Identification
    const isAdmin = user?.role === 'admin';
    const isManager = user?.role?.toUpperCase() === 'BRANCH_MANAGER';
    const isCustomer = user?.role === 'customer';

    // 2. 🏢 Branch Isolation (Handled by ContractGateway)

    // 3. 🧠 Risk Assessment (3-Level Logic)
    const timeDiff = (Date.now() - new Date(order.createdAt).getTime()) / 60000;
    let level = 'LOW';
    
    if (order.status === 'pending' && timeDiff < 2) {
      level = 'LOW';
    } else if (order.status === 'preparing' || (order.status === 'pending' && timeDiff >= 2)) {
      level = 'MEDIUM';
    } else {
      level = 'HIGH';
    }

    // Financial Risk Spike
    if (toNumber(order.total) > 50) level = 'HIGH';

    // 4. 🎯 Decision Engine Execution
    let canCancelDirectly = false;
    if (isAdmin) canCancelDirectly = true;
    else if (isManager && (level === 'LOW' || level === 'MEDIUM')) canCancelDirectly = true;
    else if (isCustomer && level === 'LOW') canCancelDirectly = true;

    if (canCancelDirectly) {
      return await this._executeFinalCancellation(order, user, reason);
    } else {
      return await this._executeCancellationRequest(order, user, reason, level);
    }
  }

  /**
   * 🛠️ Internal: Immediate Cancellation Workflow
   */
  async _executeFinalCancellation(order, user, reason) {
    const previousStatus = order.status;
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: order.id, version: order.version },
        data: {
          status: 'cancelled',
          version: { increment: 1 }
        },
        include: ORDER_INCLUDE_FULL
      });

      if (order.paymentMethod === 'wallet' && order.customerId) {
        const walletService = require('./walletService');
        await walletService.credit(order.customerId, toNumber(order.total), 'REFUND', order.orderNumber, `Refund for cancellation #${order.orderNumber}`, `cancel_${order.id}`, tx);
      }

      await tx.orderCancellation.upsert({
        where: { orderId: order.id },
        update: { status: 'approved', reason: reason || 'Approved', cancelledBy: user?.role || 'system', adminName: user?.email || 'Admin' },
        create: { orderId: order.id, reason: reason || 'Approved', cancelledBy: user?.role || 'system', previousStatus, status: 'approved', adminName: user?.email || 'Admin' }
      });
      return updated;
    }, { timeout: 15000 });

    const EventBus = require('../events/eventBus');
    EventBus.publish({ type: 'order.cancelled', payload: { order: updatedOrder, user } });
    return mapOrderResponse(updatedOrder);
  }

  /**
   * 🛠️ Internal: Cancellation Request Workflow
   */
  async _executeCancellationRequest(order, user, reason, level) {
    const previousStatus = order.status;
    const targetStatus = level === 'HIGH' ? 'waiting_cancellation_admin' : 'waiting_cancellation';

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: order.id, version: order.version },
        data: { status: targetStatus, version: { increment: 1 } },
        include: ORDER_INCLUDE_FULL
      });

      await tx.orderCancellation.upsert({
        where: { orderId: order.id },
        update: { status: 'pending', reason: reason || 'Customer requested', cancelledBy: user?.role || 'customer' },
        create: { orderId: order.id, reason: reason || 'Customer requested', cancelledBy: user?.role || 'customer', previousStatus, status: 'pending' }
      });

      // 🛰️ [CONTROL-TOWER] Integrate with FinancialApproval if HIGH risk
      if (level === 'HIGH') {
        await tx.financialApproval.create({
          data: {
            operationType: 'CANCELLATION',
            entityId: order.id.toString(),
            requestedBy: (user?.role === 'customer' ? 0 : user?.id) || 0,
            requestedByRole: user?.role || 'customer',
            payload: { reason, level, orderNumber: order.orderNumber, total: order.total },
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
          }
        });

        // 🚨 [HARDENING] Alert for high-value cancellation
        if (toNumber(order.total) > 100) {
           await tx.notification.create({
             data: {
               title: '🚨 تنبيه: إلغاء طلب ضخم!',
               message: `طلب إلغاء للطلب #${order.orderNumber} بقيمة ${toNumber(order.total)} د.أ.`,
               severity: 'CRITICAL',
               alertType: 'FINANCIAL_HIGH_RISK',
               orderId: order.id,
               targetRoute: '/operations'
             }
           });
        }
      }

      return updated;
    }, { timeout: 15000 });

    const EventBus = require('../events/eventBus');
    EventBus.publish({ type: 'order.cancellation_requested', payload: { order: updatedOrder, user, level } });
    return mapOrderResponse(updatedOrder);
  }

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

    return await this._executeFinalCancellation(order, user, order.cancellation.reason);
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

    // 0.1 🛡️ [GUEST-HARDENING] Guest Order Type Restriction
    // Guests can only place standard consumer orders (takeaway/delivery)
    if (!authUser) {
      const allowedGuestTypes = ['takeaway', 'delivery'];
      const requestedType = (orderType || 'takeaway').toLowerCase();
      if (!allowedGuestTypes.includes(requestedType)) {
        logger.security('UNAUTHORIZED_GUEST_ORDER_TYPE', {
          orderType: requestedType,
          phone: data.phone || customerPhone
        });
        throw new Error('UNAUTHORIZED_GUEST_ORDER_TYPE');
      }
    }

    const phoneInput = data.phone || customerPhone;

    // 1. 🆔 Identity & Blacklist Resolution
    const resolvedCustomer = await this._resolveAndValidateCustomer(phoneInput, authUser);

    logger.info(`[OrderService] Creating Order. AuthUser: ${authUser?.id}, InputPhone: ${phoneInput}, ResolvedCustomer: ${resolvedCustomer.id}`);

    // 1.5 🏢 Resolve Branch (Multi-Branch Ready)
    const targetBranchId = await this._resolveBranchId(data.branchId || data.branch);

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

    // 1.7 🛡️ [RACE-CONDITION-GUARD] Re-verify branch is still active
    // Protects against branch being deactivated between middleware check and order creation
    const branchStatus = await this.prisma.branch.findUnique({
      where: { id: targetBranchId },
      select: { isActive: true, name: true }
    });
    
    if (!branchStatus || !branchStatus.isActive) {
      throw new Error(`BRANCH_CLOSED: ${branchStatus?.name || 'Unknown'}`);
    }

    // 2. 🛡️ Spam Protection (Multi-factor)
    await this._validateSpamLimits(resolvedCustomer.phone);


    // 3. 💰 Pricing & Inventory Validation (Branch-Aware)
    const { validatedItems, subtotal } = await this._calculateAndValidatePricing(cartItems, targetBranchId);

    // 4. 🚚 Delivery & Region Validation
    const deliveryDetails = await this._validateDeliveryDetails(orderType, deliveryZoneId, subtotal);

    // 5. 🔢 Generate Atomic Order Number
    const orderNumber = await this._generateOrderNumber();

    // 5.5 🎁 Points Redemption Logic
    let pointsDiscount = 0;
    let pointsToDeduct = 0;

    if (data.usePoints === true) {
      const loyaltyConfig = await this.container.loyaltyService.getConfig();
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
      const order = await tx.order.create({
        data: {
          orderNumber,
          customerName: encrypt(customerName || 'زبون'),
          customerPhone: encrypt(resolvedCustomer.phone),
          customerPhoneHash: hashBlind(resolvedCustomer.phone),
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
          branchId: targetBranchId,
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
    }, { timeout: 20000 });

    // 7. 🚀 Async Side Effects (Non-blocking)
    this._triggerPostOrderEffects(newOrder);

    const mappedOrder = mapOrderResponse(newOrder);

    // 📦 Dual-Write: Publish Event to Store
    await publishEvent({
      type: eventTypes.ORDER_CREATED,
      aggregateId: mappedOrder.id,
      payload: {
        order: {
          ...mappedOrder,
          id: newOrder.id,
          customerId: newOrder.customerId,
          customerPhone: newOrder.customer?.phone || null,
          customer: newOrder.customer
        }
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
        settings = safeJsonParse(redisSettings);
        memoryCache.set('system:settings', settings, 300); // 5 mins
      } else {
        settings = await this.prisma.systemSettings.findFirst();
        if (settings) {
          await redis.set('system:settings', JSON.stringify(settings), 'EX', 3600);
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
      customer = await this.prisma.customer.findUnique({ where: { uuid: authUser.id } });
      if (customer) {
        resolvedPhone = decrypt(customer.phone);
        logger.debug(`[OrderService] Found customer by UUID ${authUser.id}: ID ${customer.id}`);
      } else {
        logger.debug(`[OrderService] No customer found for UUID ${authUser.id}. User role: ${authUser.role}`);
        // If it's an admin, we allow fallback to phone (for manual orders)
        // If it's a customer but UUID not found (stale token), we should NOT fallback to another customer's phone
        if (authUser.role !== 'admin') {
          logger.warn(`[OrderService] Authenticated customer UUID not found. Blocking fallback to prevent misattribution.`);
          return { id: null, phone: phone }; // Treat as Guest instead of linking to wrong ID
        }
      }
    }

    if (!customer && resolvedPhone) {
      customer = await this.prisma.customer.findUnique({ 
        where: { phoneHash: hashBlind(resolvedPhone) } 
      });
      if (customer) {
        logger.debug(`[OrderService] Found customer by Phone ${resolvedPhone}: ID ${customer.id}`);
      } else {
        logger.debug(`[OrderService] No customer found for Phone ${resolvedPhone}`);
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
      phone: resolvedPhone
    };
  }

  /**
   * 🏢 Helper: Resolves a branch ID from various inputs (ID, code, or fallback to default)
   */
  async _resolveBranchId(input) {
    if (!input) {
      throw new Error('BRANCH_REQUIRED: Order creation requires a valid branch context.');
    }

    // 1. If it's already a valid UUID of an existing branch
    if (input.length > 30) {
      const branch = await this.prisma.branch.findUnique({ where: { id: input }, select: { id: true } });
      logger.debug(`[_resolveBranchId] UUID check result for ${input}:`, { branch });
      if (branch) return branch.id;
    }

    // 2. If it's a code (e.g. 'KHALDA' or 'CITY')
    if (typeof input === 'string') {
      let branch = await this.prisma.branch.findUnique({ where: { code: input }, select: { id: true } });
      
      // 🕵️ Fallback: Search by Name if code doesn't match (handles Arabic names from app)
      if (!branch) {
        logger.debug(`[_resolveBranchId] Code mismatch for "${input}", trying Name lookup...`);
        branch = await this.prisma.branch.findFirst({ 
          where: { 
            OR: [
              { name: { contains: input, mode: 'insensitive' } },
              { name: input }
            ]
          }, 
          select: { id: true } 
        });
      }

      // 🕵️ Extreme Fallback: Handle "فرع ..." prefix if app sends it
      if (!branch && input.includes('فرع')) {
        const cleanName = input.replace('فرع', '').trim();
        branch = await this.prisma.branch.findFirst({
          where: { name: { contains: cleanName, mode: 'insensitive' } },
          select: { id: true }
        });
      }

      logger.debug(`[_resolveBranchId] Resolution result for "${input}":`, { branch });
      if (branch) return branch.id;
    }

    // 🚫 Strict Branch Context: If not found, reject order.
    throw new Error('INVALID_BRANCH: The specified branch does not exist.');
  }

  /**
   * 💰 Calculation Engine: Re-verifies all prices from DB to prevent client-side manipulation.
   */
  async _calculateAndValidatePricing(cartItems, branchId = null) {
    logger.info(`[Pricing] Validating ${cartItems?.length} items for branch: ${branchId}`);
    let subtotal = 0;
    const validatedItems = [];

    for (const item of cartItems) {
      const dbItem = await this.prisma.item.findUnique({
        where: { id: parseInt(item.productId || item.id) },
        include: { 
          optionGroups: { 
            where: { isActive: true },
            include: { options: { where: { isAvailable: true } } } 
          },
          branchItems: branchId ? {
            where: { branchId: branchId },
            select: { isAvailable: true }
          } : false
        }
      });

      if (!dbItem) throw new Error(`ITEM_NOT_FOUND:${item.id}`);

      // 🛡️ [BRANCH-ISOLATION] Strict Check
      if (branchId) {
        if (!dbItem.branchItems || dbItem.branchItems.length === 0) {
          throw new Error(`ITEM_NOT_IN_BRANCH:${dbItem.title}`);
        }
        
        // Branch-specific availability override
        const branchAvailability = dbItem.branchItems[0].isAvailable;
        if (!branchAvailability) throw new Error(`ITEM_UNAVAILABLE_IN_BRANCH:${dbItem.title}`);
      } else {
        // Global availability fallback (if no branch context)
        if (!dbItem.isAvailable) throw new Error(`ITEM_UNAVAILABLE:${dbItem.title}`);
      }

      let unitPrice = toNumber(dbItem.basePrice);
      const incomingOptionIds = (item.optionIds || []).map(id => parseInt(id)).filter(id => !isNaN(id));
      
      // Track which groups are already covered by incoming options
      const coveredGroupIds = new Set();
      const validatedOptionIds = [];
      const validatedOptionNames = [];
      const validatedOptionNamesEn = [];

      // 1. Process client-provided options
      if (incomingOptionIds.length > 0) {
        const dbOptions = await this.prisma.itemOption.findMany({
          where: { id: { in: incomingOptionIds } },
          include: { group: true }
        });

        for (const opt of dbOptions) {
          if (opt.group.itemId !== dbItem.id) continue; // Security: Ensure option belongs to item
          unitPrice += toNumber(opt.price);
          coveredGroupIds.add(opt.groupId);
          validatedOptionIds.push(opt.id);
          validatedOptionNames.push(opt.name);
          if (opt.nameEn) validatedOptionNamesEn.push(opt.nameEn);
        }
      }

      // 2. 🛡️ Self-Healing: Fill gaps for REQUIRED groups that were NOT provided
      for (const group of dbItem.optionGroups) {
        if (group.isRequired && !coveredGroupIds.has(group.id)) {
          // Find default option, or fallback to first available
          const fallbackOpt = group.options.find(o => o.isDefault) || group.options[0];
          if (fallbackOpt) {
            logger.warn(`[Pricing] Auto-applying default option ${fallbackOpt.name} for required group ${group.groupName} on item ${dbItem.title}`);
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

      // Construct final options text if missing or incomplete
      let finalOptionsText = item.optionsText || null;
      if (!finalOptionsText && validatedOptionNames.length > 0) {
        finalOptionsText = validatedOptionNames.join(', ');
      }

      validatedItems.push({
        itemId: dbItem.id,
        itemName: dbItem.title,
        itemNameEn: dbItem.titleEn || dbItem.title,
        quantity: qty,
        unitPrice,
        lineTotal,
        selectedOptions: finalOptionsText,
        selectedOptionsEn: validatedOptionNamesEn.length > 0 ? validatedOptionNamesEn.join(', ') : (item.optionsTextEn || null)
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
      const settings = await this.prisma.systemSettings.findFirst();
      return { fee: toNumber(settings?.defaultDeliveryFee, 1), zoneId: null, zoneName: 'Default', minOrder: 0 };
    }

    const zone = await this.prisma.deliveryZone.findUnique({ where: { id: zoneId } });
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
      this.container.analyticsService.updateCacheIncrementally({
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
    this.container.loyaltyService.awardPointsForOrder(orderId).catch(err => {
      logger.error('[Loyalty] Failed to award points on completion', { orderId, error: err.message });
    });
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

        // 🛡️ [SEC-FIX] Optimistic Locking Validation (If version was explicitly provided)
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

        const { updatedOrder, _outboxId } = await this.prisma.$transaction(async (tx) => {
          const updated = await tx.order.update({
            where: { id: order.id },
            data: { status: newStatus, version: { increment: 1 } },
            include: ORDER_INCLUDE_FULL
          });

          // 🎁 Loyalty Reward Hook
          let pointsEarned = 0;
          if (newStatus === 'delivered') {
            try {
              pointsEarned = await this.container.loyaltyService.awardPointsForOrder(updated, tx);
            } catch (err) {
              logger.error('[Loyalty] Failed to award points on status update', { orderId: updated.id, error: err.message });
            }
          }

          // 📮 Transactional Outbox Enqueue
          const outboxService = require('./outboxService');
          const outbox = await this.container.outboxService.enqueue(eventTypes.ORDER_STATUS_CHANGED, {
            previousStatus,
            newStatus,
            order: {
              ...mapOrderResponse(updated),
              pointsEarned
            }
          }, tx);

          return { updatedOrder: updated, _outboxId: outbox.id };
        }, { timeout: 15000 });

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
        // 🔄 [RETRY-LOGIC] Handle Prisma concurrency errors (P2025)
        if (error.code === 'P2025' && attempts < maxRetries - 1) {
          attempts++;
          const delay = 100 * attempts;
          logger.warn(`[OrderService] Concurrency conflict detected for Order ${orderId}. Retry ${attempts}/${maxRetries} after ${delay}ms...`);
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
            logger.info(`[OrderService] Conflict resolved by returning latest state for Order ${orderId}`);
            return {
              ...mapOrderResponse(finalOrder),
              _conflict: true,
              _message: 'تداخل في العمليات: الطلب محدث بالفعل ببيانات أخرى'
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
            await tx.orderAuditLog.create({
              data: {
                orderId: order.id,
                eventType: 'ORDER_STATUS_CHANGE',
                eventAction: 'BATCH_ACCEPTED',
                changedBy: adminEmail,
                changedByRole: 'admin',
                previousData: JSON.stringify({ status: 'pending' }),
                newData: JSON.stringify({ status: 'preparing' })
              }
            });

            acceptedCount++;
            processed.push(updated);
          } catch (err) {
            // P2025: Record to update not found (Concurrency conflict)
            if (err.code === 'P2025') {
              skippedCount++;
              logger.warn(`[BatchAccept] Order ${order.id} skipped due to concurrency conflict.`);
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
        (async () => {
          for (const order of processedOrders) {
            try {
              const mappedOrder = mapOrderResponse(order);
              await publishEvent({
                type: eventTypes.ORDER_STATUS_CHANGED,
                aggregateId: mappedOrder.id,
                payload: { previousStatus: 'pending', newStatus: 'preparing', order: mappedOrder },
                version: order.version
              });

              this.container.analyticsService.updateCacheIncrementally({
                type: 'ORDER_STATUS_CHANGE',
                amount: toNumber(order.total),
                status: 'preparing',
                branchId: order.branchId
              });

              await this.bumpBranchVersion(order.branchId);
            } catch (err) {
              logger.error(`[BatchAccept] Side-effects failed for order ${order.id}`, { error: err.message });
            }
          }
        })().catch(err => logger.error('[BatchAccept] Post-processing worker failed', { error: err.message }));
      }

      return results;
    } catch (error) {
      logger.error('[BatchAccept] Transaction failed', { error: error.message });
      throw error;
    }
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
