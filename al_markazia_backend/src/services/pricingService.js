const { toNumber, toMoney } = require('../utils/number');

/**
 * 💰 Pricing Engine (Canonical Single Source of Truth)
 * Purpose: Centralizes all financial calculations for the entire platform.
 * Ensures consistent handling of taxes, discounts, and rounding.
 * 
 * RULES:
 * 1. Inclusive Tax: All prices ALREADY include 16% sales tax.
 * 2. Formula: Total = Subtotal + Delivery - Discount.
 * 3. Accuracy: Always round to 2 decimal places using toMoney.
 */
class PricingService {
  
  /**
   * 🏗️ Core Calculation Logic
   * Input: items (with unitPrice & quantity), deliveryFee, discount.
   * Output: Complete financial breakdown.
   */
  calculateOrderTotals(items, deliveryFee = 0, discount = 0) {
    // 1. Calculate raw subtotal (Sum of line totals)
    const rawSubtotal = items.reduce((sum, item) => {
      const unitPrice = toNumber(item.unitPrice);
      const quantity = parseInt(item.quantity || 1);
      return sum + (unitPrice * quantity);
    }, 0);

    const subtotal = toMoney(rawSubtotal);
    const finalDeliveryFee = toNumber(deliveryFee);
    const finalDiscount = toNumber(discount);

    // 2. Final Total (Inclusive of Tax)
    const total = toMoney(subtotal + finalDeliveryFee - finalDiscount);

    // 3. Tax Extraction (16% Inclusive) for reporting/audit
    const baseAmount = toMoney(subtotal / 1.16);
    const taxAmount = toMoney(subtotal - baseAmount);

    return {
      subtotal,        // Total of items (inclusive of tax)
      tax: taxAmount,  // Extracted tax portion
      base: baseAmount, // Price before tax
      deliveryFee: finalDeliveryFee,
      discount: finalDiscount,
      total,           // Final amount to pay/refund
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 🔍 Calculate Modification Impact
   * Useful for partial cancellations and refunds.
   */
  calculateImpact(oldTotal, newTotal) {
    const diff = toNumber(oldTotal) - toNumber(newTotal);
    return {
      difference: toMoney(diff),
      isRefund: diff > 0,
      isCharge: diff < 0,
      absoluteAmount: Math.abs(toMoney(diff))
    };
  }
}

module.exports = new PricingService();
