const Decimal = require('decimal.js');

/**
 * 🏛️ Centralized Financial Rules & Rounding Configuration
 * Guarantees zero calculation drift across distributed microservices.
 */
module.exports = {
  LOYALTY: {
    ROUNDING_MODE: Decimal.ROUND_HALF_UP, // Enterprise financial banking standard
    POINT_PRECISION: 0,                   // Loyalty points strictly bounded to integer counts
    MIN_POINTS: 0,                        // Enforce non-negative ledger thresholds
    MAX_POINTS: 999999999                 // Guard ceiling mitigating point super-inflation
  },
  WALLET: {
    ROUNDING_MODE: Decimal.ROUND_HALF_UP,
    CURRENCY_PRECISION: 2                 // Ledger monetary currency fractional decimals
  }
};
