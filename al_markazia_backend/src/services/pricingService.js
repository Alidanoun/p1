const { toNumber, toMoney } = require('../utils/number');

/**
 * 💰 Pricing Engine (Pure Functional Core)
 * Single Source of Truth for financial calculations.
 * RULES:
 * 1. No Database calls.
 * 2. No side effects.
 * 3. Immutable inputs/outputs.
 */
class PricingService {
  
  /**
   * 🏗️ Core Calculation Logic
   * Input: items (with unitPrice & qty), deliveryFee, discount.
   * Output: Detailed breakdown object.
   */
  calculateOrder(items, deliveryFee = 0, discount = 0, taxRate = 0) {
    let subtotal = 0;
    
    const calculatedItems = items.map(item => {
      const unitPrice = toNumber(item.unitPrice);
      const qty = parseInt(item.quantity || 1);
      const lineTotal = toMoney(unitPrice * qty);
      subtotal += lineTotal;

      return {
        ...item,
        unitPrice,
        quantity: qty,
        lineTotal
      };
    });

    const tax = toMoney(subtotal * toNumber(taxRate));
    const total = toMoney(subtotal + toNumber(deliveryFee) + tax - toNumber(discount));

    return {
      subtotal: toMoney(subtotal),
      deliveryFee: toNumber(deliveryFee),
      discount: toNumber(discount),
      tax: toMoney(tax),
      total: toMoney(total),
      items: calculatedItems,
      timestamp: Date.now()
    };
  }

  /**
   * 🔍 Calculate Modification Impact
   * Compares two snapshots to find the financial delta.
   */
  calculateDelta(oldSummary, newSummary) {
    return {
      priceDifference: toMoney(newSummary.total - oldSummary.total),
      isRefund: newSummary.total < oldSummary.total,
      isExtraCharge: newSummary.total > oldSummary.total,
      absoluteDifference: Math.abs(toMoney(newSummary.total - oldSummary.total))
    };
  }
}

module.exports = new PricingService();
