const { toDecimal, Decimal } = require('../utils/number');

/**
 * 🧮 Financial & Loyalty Logic Service (Centralized Integrity Layer)
 * Handles all point increments, price calculations, and ledger entries.
 */
class FinancialService {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
  }

  /**
   * 🪙 Atomic Point Reward (Refactored to Ledger)
   */
  async awardPoints(customerId, amount, type, tx = null) {
    const points = Math.floor(amount);
    if (points <= 0) return null;

    const ledgerEntry = await this.container.loyaltyLedgerService.credit(
      customerId,
      points,
      'ADJUSTMENT',
      null,
      `Reward: ${type}`,
      `fin:award:${customerId}:${type}:${Date.now()}`,
      { type },
      tx
    );

    // Sync projection if not in external tx (internal tx handles sync after commit in consumer/caller)
    if (!tx) {
      await this.container.loyaltyLedgerService.syncProjection(customerId, ledgerEntry.balanceAfter);
    }

    return await this.prisma.customer.findUnique({ where: { id: customerId } });
  }

  /**
   * 💸 Atomic Points Deduction (Refactored to Ledger)
   */
  async deductPoints(customerId, amount, tx = null) {
    const points = Math.floor(amount);
    
    const ledgerEntry = await this.container.loyaltyLedgerService.debit(
      customerId,
      points,
      'ADJUSTMENT',
      null,
      'Point Deduction',
      `fin:deduct:${customerId}:${Date.now()}`,
      {},
      tx
    );

    // Sync projection if not in external tx
    if (!tx) {
      await this.container.loyaltyLedgerService.syncProjection(customerId, ledgerEntry.balanceAfter);
    }

    return await this.prisma.customer.findUnique({ where: { id: customerId } });
  }

  /**
   * 🌙 Midnight Logic Converter
   */
  getMinutesSinceMidnight(dateTime) {
    return dateTime.hour * 60 + dateTime.minute;
  }

  parseTimeToMinutes(timeString) {
    if (!timeString) return 0;
    const [h, m] = timeString.split(':').map(Number);
    return h * 60 + m;
  }

  /**
   * 🛡️ Safe Financial Calculation
   * Prevents floating point errors by using Decimal.js logic via Prisma/Database.
   */
  calculatePointsFromSubtotal(subtotal, rate, multiplier = 1) {
    const subDec = toDecimal(subtotal);
    const rateDec = toDecimal(rate);
    const multDec = toDecimal(multiplier);
    return subDec.times(rateDec).times(multDec).floor().toNumber();
  }
}

// --- 🛡️ Backward Compatibility ---
const getContainer = () => require('../lib/container');
const proxy = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'FinancialService') return FinancialService;
    const service = getContainer().financialService;
    const val = service[prop];
    return typeof val === 'function' ? val.bind(service) : val;
  }
});

module.exports = proxy;
module.exports.FinancialService = FinancialService;
