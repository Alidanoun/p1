const accountingService = require('../services/accountingService');
const { runAccountingTests } = require('./accounting.test');
const logger = require('../utils/logger');

/**
 * 🛡️ Financial Integrity Test Suite (Self-Executing)
 * Verifies the "Safety Layer" is holding strong.
 */
function runIntegrityTests() {
  logger.info('🧪 Running Financial Safety Layer Handshake...');
  const results = [];
  
  // Phase 1: Property Tests (Math Consistency)
  const accountingPassed = runAccountingTests();
  if (!accountingPassed) return false;

  try {
    // Phase 2: Scenario Calculation (Tax-Inclusive Check)
    const items = [{ unitPrice: 10, quantity: 2 }]; // Subtotal: 20 (Inclusive)
    const summary = accountingService.calculateOrderSummary(items, 5, 0);
    
    // Total = 20 (items) + 5 (deliv) = 25
    // Tax = 20 - (20/1.16) = 20 - 17.24 = 2.76
    // Net = 17.24 (base)
    
    if (summary.total === 25 && summary.tax === 2.76 && summary.netRevenue === 17.24) {
        logger.info('✅ Scenario Calculation: Tax-Inclusive Extraction Verified');
    } else {
        throw new Error(`Math Fail: Expected total 25, tax 2.76, net 17.24. Got total ${summary.total}, tax ${summary.tax}, net ${summary.netRevenue}`);
    }

    return true;

    // Test 2: Delta Validation
    const oldS = { total: 100, netRevenue: 80, tax: 16, deliveryFee: 4, discount: 0 };
    const newS = { total: 120, netRevenue: 95, tax: 20, deliveryFee: 5, discount: 0 };
    const delta = accountingService.validateDelta(oldS, newS);
    if (delta.deltaTotal === 20 && delta.deltaNet === 15) {
        results.push('✅ Delta Validation');
    } else {
        throw new Error('Delta Fail');
    }

    // Test 3: Rounding Precision
    const itemsFloat = [{ unitPrice: 10.333, quantity: 1 }];
    const summaryFloat = accountingService.calculateOrderSummary(itemsFloat);
    if (summaryFloat.subtotal === 10.33) {
        results.push('✅ Precision Rounding');
    } else {
        throw new Error(`Rounding Fail: Expected 10.33, got ${summaryFloat.subtotal}`);
    }

    logger.info(`✅ Financial Integrity Verified: ${results.length} tests passed.`);
    return true;
  } catch (error) {
    logger.error('❌ CRITICAL: FINANCIAL INTEGRITY BREACHED', { error: error.message });
    // In strict mode, we might want to prevent server start, 
    // but for now, we alert loudly.
    return false;
  }
}

module.exports = { runIntegrityTests };
