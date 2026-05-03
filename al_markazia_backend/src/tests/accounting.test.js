const accountingService = require('../services/accountingService');
const logger = require('../utils/logger');

/**
 * 🧪 Accounting Property-Based Tests
 * Verifies the integrity of the tax-inclusive engine.
 */
function runAccountingTests() {
  logger.info('🧪 Starting Phase 3: Accounting Property Tests...');
  const failures = [];

  // 1. Static Unit Test: 10 JOD includes tax
  try {
    const result = accountingService.extractTax(10);
    // base = 10 / 1.16 = 8.6206... -> 8.62
    // tax = 10 - 8.62 = 1.38
    if (result.base === 8.62 && result.tax === 1.38 && result.total === 10) {
      logger.info('✅ Unit Test: 10 JOD Extraction Passed');
    } else {
      throw new Error(`10 JOD Extraction Fail: Got base=${result.base}, tax=${result.tax}`);
    }
  } catch (e) { failures.push(e.message); }

  // 2. Property Test: Sum Integrity (1000 iterations)
  try {
    let successCount = 0;
    for (let i = 0; i < 1000; i++) {
      const price = Math.random() * 500;
      const { base, tax, total } = accountingService.extractTax(price);
      
      // Floating point check: allow for 0.01 tolerance due to dual rounding
      const diff = Math.abs((base + tax) - total);
      if (diff <= 0.01) {
        successCount++;
      } else {
        throw new Error(`Property Fail at ${price}: ${base} + ${tax} != ${total}`);
      }
    }
    logger.info(`✅ Property Test: ${successCount}/1000 Iterations Passed`);
  } catch (e) { failures.push(e.message); }

  // 3. Logic Locking Check
  try {
    accountingService.TAX_RATE = 0.20; // Try to mutate
    if (accountingService.TAX_RATE === 0.16) {
      logger.info('✅ Logic Locking: Immutable Service Verified');
    } else {
      throw new Error('Logic Locking Fail: Object mutated!');
    }
  } catch (e) { failures.push(e.message); }

  if (failures.length === 0) {
    logger.info('💎 [FINANCE] Phase 3: All Integrity Checks Passed.');
    return true;
  } else {
    logger.error('❌ [FINANCE] Phase 3: Integrity Checks FAILED', { failures });
    return false;
  }
}

// Auto-run if executed directly
if (require.main === module) {
  runAccountingTests();
}

module.exports = { runAccountingTests };
