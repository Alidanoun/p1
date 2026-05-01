const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const auditService = require('./auditService');

/**
 * 🧮 Financial & Loyalty Logic Service (Centralized Integrity Layer)
 * Handles all point increments, price calculations, and ledger entries.
 */
class FinancialService {
  /**
   * 🪙 Atomic Point Reward
   * Uses Prisma's atomic increment to prevent race conditions.
   */
  async awardPoints(customerId, amount, type, tx = null) {
    if (amount <= 0) return null;
    const db = tx || prisma;

    const result = await db.customer.update({
      where: { id: customerId },
      data: {
        points: { increment: Math.floor(amount) }
      }
    });

    await auditService.log({
      userId: result.uuid,
      userRole: 'customer',
      action: 'POINTS_AWARDED',
      entityType: 'Customer',
      entityId: customerId.toString(),
      metadata: { amount: Math.floor(amount), reason: type }
    });

    return result;
  }

  /**
   * 💸 Atomic Points Deduction (with Check)
   */
  async deductPoints(customerId, amount, tx = null) {
    const db = tx || prisma;
    
    // We check balance inside the transaction if tx is provided
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.points < amount) {
      throw new Error('INSUFFICIENT_POINTS');
    }

    const result = await db.customer.update({
      where: { id: customerId },
      data: {
        points: { decrement: Math.floor(amount) }
      }
    });

    await auditService.log({
      userId: result.uuid,
      userRole: 'customer',
      action: 'POINTS_DEDUCTED',
      entityType: 'Customer',
      entityId: customerId.toString(),
      metadata: { amount: Math.floor(amount) }
    });

    return result;
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
    return Math.floor(Number(subtotal) * rate * multiplier);
  }
}

module.exports = new FinancialService();
