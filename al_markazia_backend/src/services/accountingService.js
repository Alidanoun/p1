const { toNumber, toMoney, toDecimal, Decimal } = require('../utils/number');
const logger = require('../utils/logger');

/**
 * 💰 Accounting Service (Production-Hardened via Decimal.js)
 * 🛡️ RULE: All prices are INCLUSIVE of 16% Sales Tax.
 * 🛡️ RULE: No addition of tax above the price. Extraction only.
 * 🛡️ RULE: Using ROUND_HALF_UP for customer-facing invoices.
 */
class AccountingService {
  constructor() {
    this.TAX_RATE = new Decimal('0.16');
    this.TAX_DIVISOR = new Decimal('1.16'); // 1 + 0.16
  }

  /**
   * Safely rounds to 2 decimal places using ROUND_HALF_UP.
   * Using ROUND_HALF_UP for customer-facing invoices
   */
  round(value) {
    return toMoney(value);
  }

  /**
   * 🧾 Extracts Tax and Base price from a Tax-Inclusive price using exact Decimal arithmetic.
   * Formula: base = price / 1.16 | tax = price - base
   * 🛡️ Fixed to prevent "Penny Drift" by deriving tax from rounded base.
   */
  extractTax(totalPrice) {
    const totalDec = toDecimal(totalPrice);
    const total = totalDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    
    const baseDec = totalDec.dividedBy(this.TAX_DIVISOR);
    const base = baseDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    
    const taxDec = new Decimal(total).minus(base);
    const tax = taxDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

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
    // 1. Gross Revenue is the raw sum of item totals (Inclusive of tax) using Decimal reduction
    const rawSubtotalDec = items.reduce((sumDec, item) => {
      const unitDec = toDecimal(item.unitPrice);
      const qtyDec = new Decimal(parseInt(item.quantity || 1));
      return sumDec.plus(unitDec.times(qtyDec));
    }, new Decimal(0));

    // Using ROUND_HALF_UP for customer-facing invoices
    const subtotal = rawSubtotalDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    
    const deliveryDec = toDecimal(deliveryFee);
    const discountDec = toDecimal(discount);

    const finalTotalDec = rawSubtotalDec.plus(deliveryDec).minus(discountDec);
    const finalTotal = finalTotalDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    
    // 2. Extract tax from the raw subtotal (The product portion)
    const baseDec = rawSubtotalDec.dividedBy(this.TAX_DIVISOR);
    const base = baseDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    
    const taxDec = new Decimal(subtotal).minus(base);
    const tax = taxDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    
    // 3. Net Revenue = Base Product Price - Discount
    const netRevenueDec = baseDec.minus(discountDec);
    const netRevenue = netRevenueDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

    return {
      subtotal,        // السعر الإجمالي للمنتجات (شامل الضريبة)
      tax,             // قيمة الضريبة المستخرجة (16%)
      base,            // السعر الصافي للمنتجات قبل الضريبة
      deliveryFee: deliveryDec.toNumber(),
      discount: discountDec.toNumber(),
      total: finalTotal, // الإجمالي الذي يدفعه العميل
      netRevenue       // الربح الصافي (Base - Discount)
    };
  }

  /**
   * Validates financial deltas between two summaries.
   */
  validateDelta(oldSummary, newSummary) {
    return {
      deltaTotal: toDecimal(newSummary.total).minus(toDecimal(oldSummary.total)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      deltaNet: toDecimal(newSummary.netRevenue).minus(toDecimal(oldSummary.netRevenue)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      deltaTax: toDecimal(newSummary.tax).minus(toDecimal(oldSummary.tax)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      deltaDelivery: toDecimal(newSummary.deliveryFee).minus(toDecimal(oldSummary.deliveryFee)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      deltaDiscount: toDecimal(newSummary.discount).minus(toDecimal(oldSummary.discount)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
    };
  }

  /**
   * Structured audit log generation.
   */
  createAuditLog(event, orderId, before, after, actorId, metadata = {}) {
    const beforeDec = toDecimal(before);
    const afterDec = toDecimal(after);
    return {
      trace_id: `txn_${Date.now()}_${orderId}`,
      event,
      order_id: orderId,
      before: beforeDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      after: afterDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      delta: afterDec.minus(beforeDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      actor: actorId || 'system',
      timestamp: new Date().toISOString(),
      ...metadata
    };
  }
}

const service = new AccountingService();
Object.freeze(service);

module.exports = service;
