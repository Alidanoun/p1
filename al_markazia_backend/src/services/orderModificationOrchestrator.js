const pricingService = require('./pricingService');
const walletService = require('./walletService');
const modificationService = require('./orderModificationService');
const policyEngine = require('./orderModificationPolicyEngine');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

/**
 * 🎼 Order Modification Orchestrator
 * The central point for coordinating complex domain logic.
 */
class OrderModificationOrchestrator {

  /**
   * 🔍 Phase 1: Preview (Read-only impact analysis)
   */
  async preview(orderId, modifications, user) {
    const order = await this._getOrderSnapshot(orderId);
    
    // ⚖️ Decision Layer: Is this even allowed?
    const policy = policyEngine.evaluate(order, modifications, user);
    if (!policy.allowed) throw new Error(`POLICY_REJECTED:${policy.reason}`);

    // Pure calculation via Pricing Engine
    const oldSummary = pricingService.calculateOrder(order.orderItems, order.deliveryFee, order.discount);
    
    // Simulate changes
    const newItems = this._simulateChanges(order.orderItems, modifications);
    const newSummary = pricingService.calculateOrder(newItems, order.deliveryFee, order.discount);
    
    const delta = pricingService.calculateDelta(oldSummary, newSummary);

    // 🕵️ Shadow Logging (Controlled Live Execution Mode)
    // Records the intended impact without persisting changes
    logger.info('[ShadowMode] Modification Preview Audit', {
      orderId,
      action: modifications.type,
      delta: delta.priceDifference,
      itemsCount: newItems.length,
      policyStatus: policy.allowed ? 'ALLOWED' : 'REJECTED'
    });

    return {
      orderId,
      orderVersion: order.version,
      policy,
      preview: {
        oldTotal: oldSummary.total,
        newTotal: newSummary.total,
        priceDifference: delta.priceDifference,
        isRefund: delta.isRefund,
        absoluteDifference: delta.absoluteDifference
      }
    };
  }

  /**
   * 📝 Phase 2: Request (Create Pending Event)
   */
  async request(orderId, adminId, modifications, idempotencyKey, user) {
    const order = await this._getOrderSnapshot(orderId);
    
    // ⚖️ Re-verify policy at request time
    const policy = policyEngine.evaluate(order, modifications, user);
    if (!policy.allowed) throw new Error(`POLICY_REJECTED:${policy.reason}`);

    // Recalculate everything for the final request payload
    const oldSummary = pricingService.calculateOrder(order.orderItems, order.deliveryFee, order.discount);
    const newItems = await this._simulateChanges(order.orderItems, modifications);
    const newSummary = pricingService.calculateOrder(newItems, order.deliveryFee, order.discount);
    const delta = pricingService.calculateDelta(oldSummary, newSummary);

    // Pass enriched data to Domain Service
    return await modificationService.requestModification(orderId, adminId, {
      ...modifications,
      oldSummary,
      newSummary,
      delta
    });
  }

  /**
   * ✅ Phase 3: Apply (Finalize Financial & State changes)
   */
  async apply(eventId, actorId, idempotencyKey) {
    return await modificationService.applyModification(eventId, actorId);
  }

  // --- Helpers ---

  async _getOrderSnapshot(orderId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: { where: { status: 'normal' } } }
    });
    if (!order) throw new Error('ORDER_NOT_FOUND');
    return order;
  }

  async _simulateChanges(currentItems, modifications) {
    if (modifications.type === 'FULL_CANCEL') {
      return []; // All items removed
    }

    let items = [...currentItems];

    // 1. Handle Removals (Partial Cancel)
    if (modifications.removeIds) {
      items = items.filter(i => !modifications.removeIds.includes(i.id));
    }

    // 2. Handle Replacements (REPLACE_ITEM)
    if (modifications.type === 'REPLACE_ITEM' && modifications.replacement) {
      const { oldItemId, newItemId, quantity } = modifications.replacement;
      
      // Remove the old item
      items = items.filter(i => i.id !== oldItemId);

      // Fetch the new item data for pricing
      const dbNewItem = await prisma.item.findUnique({
        where: { id: newItemId },
        include: { optionGroups: { include: { options: true } } }
      });

      if (dbNewItem) {
        items.push({
          itemId: dbNewItem.id,
          unitPrice: dbNewItem.basePrice,
          quantity: quantity || 1,
          isSimulation: true // Flag for orchestrator logic
        });
      }
    }

    return items;
  }
}

module.exports = new OrderModificationOrchestrator();
