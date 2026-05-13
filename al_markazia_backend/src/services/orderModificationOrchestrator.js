/**
 * 🎼 Order Modification Orchestrator
 */
class OrderModificationOrchestrator {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
  }

  async preview(orderId, modifications, user) {
    const pricingService = require('./pricingService');
    const policyEngine = require('./orderModificationPolicyEngine');
    
    const order = await this._getOrderSnapshot(orderId);
    
    // 🛡️ [SECURITY] Guard Ownership & Item Scope
    this._verifyOrderOwnership(order, user);
    this._validateModificationItems(order, modifications);

    const policy = policyEngine.evaluate(order, modifications, user);
    if (!policy.allowed) throw new Error(`POLICY_REJECTED:${policy.reason}`);

    const oldSummary = pricingService.calculateOrder(order.orderItems, order.deliveryFee, order.discount);
    const newItems = await this._simulateChanges(order.orderItems, modifications);
    const newSummary = pricingService.calculateOrder(newItems, order.deliveryFee, order.discount);
    const delta = pricingService.calculateDelta(oldSummary, newSummary);

    return {
      orderId, orderVersion: order.version, policy,
      preview: {
        oldTotal: oldSummary.total, newTotal: newSummary.total,
        priceDifference: delta.priceDifference, isRefund: delta.isRefund, absoluteDifference: delta.absoluteDifference
      }
    };
  }

  async request(orderId, adminId, modifications, idempotencyKey, user) {
    const pricingService = require('./pricingService');
    const policyEngine = require('./orderModificationPolicyEngine');
    const modificationService = require('./orderModificationService');
    
    const order = await this._getOrderSnapshot(orderId);
    
    // 🛡️ [SECURITY] Guard Ownership & Item Scope
    this._verifyOrderOwnership(order, user);
    this._validateModificationItems(order, modifications);

    const policy = policyEngine.evaluate(order, modifications, user);
    if (!policy.allowed) throw new Error(`POLICY_REJECTED:${policy.reason}`);

    const oldSummary = pricingService.calculateOrder(order.orderItems, order.deliveryFee, order.discount);
    const newItems = await this._simulateChanges(order.orderItems, modifications);
    const newSummary = pricingService.calculateOrder(newItems, order.deliveryFee, order.discount);
    const delta = pricingService.calculateDelta(oldSummary, newSummary);

    return await modificationService.requestModification(orderId, adminId, {
      ...modifications, oldSummary, newSummary, delta
    });
  }

  async apply(eventId, actorId, idempotencyKey) {
    const modificationService = require('./orderModificationService');
    return await modificationService.applyModification(eventId, actorId);
  }

  async _getOrderSnapshot(orderId) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: { where: { status: 'normal' } } }
    });
    if (!order) throw new Error('ORDER_NOT_FOUND');
    return order;
  }

  _verifyOrderOwnership(order, user) {
    if (!user) throw new Error('UNAUTHORIZED_ORDER_ACCESS');
    const role = (user.role || '').toLowerCase();
    const isCustomer = role === 'customer';
    const isAdminRoles = ['admin', 'branch_manager', 'manager'].includes(role);

    if (isCustomer && order.customerId !== user.id) {
      if (this.logger && typeof this.logger.security === 'function') {
        this.logger.security('UNAUTHORIZED_ORDER_ACCESS_ATTEMPT', {
          userId: user.id,
          targetOrderId: order.id,
          targetCustomerId: order.customerId
        });
      }
      throw new Error('UNAUTHORIZED_ORDER_ACCESS');
    }

    if (isAdminRoles && role !== 'admin' && order.branchId !== user.branchId) {
      if (this.logger && typeof this.logger.security === 'function') {
        this.logger.security('UNAUTHORIZED_BRANCH_ACCESS_ATTEMPT', {
          userId: user.id,
          targetOrderId: order.id,
          targetBranchId: order.branchId,
          actualBranchId: user.branchId
        });
      }
      throw new Error('UNAUTHORIZED_BRANCH_ACCESS');
    }

    return true;
  }

  _validateModificationItems(order, modifications) {
    if (!modifications.removeIds || modifications.removeIds.length === 0) {
      return;
    }

    const validItemIds = new Set((order.orderItems || []).map(item => String(item.id)));

    for (const itemId of modifications.removeIds) {
      if (!validItemIds.has(String(itemId))) {
        if (this.logger && typeof this.logger.warn === 'function') {
          this.logger.warn('INVALID_MODIFICATION_ITEM_ATTEMPT', {
            orderId: order.id,
            invalidItemId: itemId
          });
        }
        throw new Error('INVALID_ITEM_ID');
      }
    }

    const remainingCount = (order.orderItems || []).length - modifications.removeIds.length;
    if (remainingCount === 0 && modifications.type !== 'FULL_CANCEL') {
      throw new Error('CANNOT_REMOVE_ALL_ITEMS_WITHOUT_FULL_CANCEL');
    }
  }

  async _simulateChanges(currentItems, modifications) {
    if (modifications.type === 'FULL_CANCEL') return [];
    if (!modifications.removeIds || modifications.removeIds.length === 0) {
      return [...currentItems];
    }
    const removeSet = new Set(modifications.removeIds.map(id => String(id)));
    return currentItems.filter(item => !removeSet.has(String(item.id)));
  }
}

// --- 🛡️ Backward Compatibility ---
const getContainer = () => require('../lib/container');
const proxy = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'OrderModificationOrchestrator') return OrderModificationOrchestrator;
    const service = getContainer().orderModificationOrchestrator;
    const val = service[prop];
    return typeof val === 'function' ? val.bind(service) : val;
  }
});

module.exports = proxy;
module.exports.OrderModificationOrchestrator = OrderModificationOrchestrator;
