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

  async _simulateChanges(currentItems, modifications) {
    if (modifications.type === 'FULL_CANCEL') return [];
    let items = [...currentItems];
    if (modifications.removeIds) {
      items = items.filter(i => !modifications.removeIds.includes(i.id));
    }
    return items;
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
