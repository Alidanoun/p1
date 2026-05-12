const { toNumber, toMoney, toDecimal, Decimal } = require('../utils/number');

/**
 * 💰 Pricing Engine (Canonical Single Source of Truth)
 * Purpose: Centralizes all financial calculations for the entire platform.
 * Ensures consistent handling of taxes, discounts, and rounding.
 * 
 * RULES:
 * 1. Inclusive Tax: All prices ALREADY include 16% sales tax.
 * 2. Formula: Total = Subtotal + Delivery - Discount.
 * 3. Accuracy: Always round to 2 decimal places using ROUND_HALF_UP.
 */
class PricingService {
  
  /**
   * 🏗️ Core Calculation Logic
   * Input: items (with unitPrice & quantity), deliveryFee, discount.
   * Output: Complete financial breakdown.
   */
  calculateOrderTotals(items, deliveryFee = 0, discount = 0) {
    // 1. Calculate raw subtotal using Decimal.js to prevent IEEE 754 precision drift
    // Retain as Decimal objects inside the reduction loop until the very last step.
    const rawSubtotalDecimal = items.reduce((sumDec, item) => {
      const unitPriceDec = toDecimal(item.unitPrice);
      const quantityDec = new Decimal(parseInt(item.quantity || 1));
      return sumDec.plus(unitPriceDec.times(quantityDec));
    }, new Decimal(0));

    // Using ROUND_HALF_UP for customer-facing invoices
    const subtotal = rawSubtotalDecimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    
    const deliveryFeeDec = toDecimal(deliveryFee);
    const discountDec = toDecimal(discount);

    // 2. Final Total (Inclusive of Tax) derived with Lazy Rounding
    const totalDecimal = rawSubtotalDecimal.plus(deliveryFeeDec).minus(discountDec);
    const total = totalDecimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

    // 3. Tax Extraction (16% Inclusive) calculated precisely via Decimal division
    const taxRateDivisor = new Decimal('1.16');
    const baseDecimal = rawSubtotalDecimal.dividedBy(taxRateDivisor);
    const baseAmount = baseDecimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    
    // Derive tax precisely as difference between rounded subtotal and rounded base to prevent penny drift
    const taxDecimal = new Decimal(subtotal).minus(baseAmount);
    const taxAmount = taxDecimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

    return {
      subtotal,        // Total of items (inclusive of tax)
      tax: taxAmount,  // Extracted tax portion
      base: baseAmount, // Price before tax
      deliveryFee: deliveryFeeDec.toNumber(),
      discount: discountDec.toNumber(),
      total,           // Final amount to pay/refund
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 🔍 Calculate Modification Impact
   * Useful for partial cancellations and refunds.
   */
  calculateImpact(oldTotal, newTotal) {
    const diffDec = toDecimal(oldTotal).minus(toDecimal(newTotal));
    const difference = diffDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    return {
      difference,
      isRefund: diffDec.isPositive() && !diffDec.isZero(),
      isCharge: diffDec.isNegative(),
      absoluteAmount: Math.abs(difference)
    };
  }
}

module.exports = new PricingService();
