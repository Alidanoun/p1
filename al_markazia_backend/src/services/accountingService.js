const { toNumber, toMoney } = require('../utils/number');
const logger = require('../utils/logger');

/**
 * 💰 Accounting Service (Production-Hardened)
 * 🛡️ RULE: All prices are INCLUSIVE of 16% Sales Tax.
 * 🛡️ RULE: No addition of tax above the price. Extraction only.
 */
class AccountingService {
  constructor() {
    this.TAX_RATE = 0.16;
  }

  /**
   * Safely rounds to 2 decimal places.
   */
  round(value) {
    return toMoney(value);
  }

  /**
   * 🧾 Extracts Tax and Base price from a Tax-Inclusive price.
   * Formula: base = price / 1.16 | tax = price - base
   * 🛡️ Fixed to prevent "Penny Drift" by deriving tax from rounded base.
   */
  extractTax(totalPrice) {
    const total = this.round(toNumber(totalPrice));
    const base = this.round(total / (1 + this.TAX_RATE));
    const tax = this.round(total - base); // Derived to ensure total matches sum

    return {
      base,
      tax,
      total
    };
  }

  /**
   * Calculates order components assuming price is ALREADY inclusive of tax.
   */
  calculateOrderSummary(items, deliveryFee = 0, discount = 0) {
    // 1. Gross Revenue is the raw sum of item totals (Inclusive of tax)
    const rawSubtotal = items.reduce((sum, item) => 
      sum + (toNumber(item.unitPrice) * toNumber(item.quantity)), 0
    );

    const subtotal = this.round(rawSubtotal);
    const finalTotal = this.round(subtotal + toNumber(deliveryFee) - toNumber(discount));
    
    // 2. Extract tax from the subtotal (The product portion)
    const { base, tax } = this.extractTax(subtotal);
    
    // 3. Net Revenue = Base Product Price - Discount
    // (Delivery Fee is usually operational revenue, kept separate)
    const netRevenue = this.round(base - toNumber(discount));

    return {
      subtotal,        // السعر الإجمالي للمنتجات (شامل الضريبة)
      tax,             // قيمة الضريبة المستخرجة (16%)
      base,            // السعر الصافي للمنتجات قبل الضريبة
      deliveryFee: toNumber(deliveryFee),
      discount: toNumber(discount),
      total: finalTotal, // الإجمالي الذي يدفعه العميل
      netRevenue       // الربح الصافي (Base - Discount)
    };
  }

  /**
   * Validates financial deltas between two summaries.
   */
  validateDelta(oldSummary, newSummary) {
    return {
      deltaTotal: this.round(toNumber(newSummary.total) - toNumber(oldSummary.total)),
      deltaNet: this.round(toNumber(newSummary.netRevenue) - toNumber(oldSummary.netRevenue)),
      deltaTax: this.round(toNumber(newSummary.tax) - toNumber(oldSummary.tax)),
      deltaDelivery: this.round(toNumber(newSummary.deliveryFee) - toNumber(oldSummary.deliveryFee)),
      deltaDiscount: this.round(toNumber(newSummary.discount) - toNumber(oldSummary.discount))
    };
  }

  /**
   * Structured audit log generation.
   */
  createAuditLog(event, orderId, before, after, actorId, metadata = {}) {
    return {
      trace_id: `txn_${Date.now()}_${orderId}`,
      event,
      order_id: orderId,
      before: this.round(before),
      after: this.round(after),
      delta: this.round(toNumber(after) - toNumber(before)),
      actor: actorId || 'system',
      timestamp: new Date().toISOString(),
      ...metadata
    };
  }
}

const service = new AccountingService();
Object.freeze(service);

module.exports = service;
