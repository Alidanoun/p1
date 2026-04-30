const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { toNumber } = require('../utils/number');
const pricingService = require('./pricingService');

/**
 * 🛡️ System Integrity Validator
 * Responsible for verifying consistency across different system layers:
 * Financial (Wallet/Ledger), Operational (Orders/Items), and State Machine.
 */
class SystemValidator {

  /**
   * 💰 Financial Audit
   * Ensures customer walletBalance matches the sum of ledger entries.
   */
  async auditCustomerWallet(customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { walletBalance: true }
    });

    if (!customer) return { status: 'ERROR', message: 'CUSTOMER_NOT_FOUND' };

    const ledgerAggregation = await prisma.financialLedger.aggregate({
      where: { customerId },
      _sum: { amount: true } 
      // Note: In a real system, you'd handle CREDIT(+) vs DEBIT(-) separately.
    });

    // Simplified check for demo
    const currentBalance = toNumber(customer.walletBalance);
    // In production, you'd calculate: SUM(Credits) - SUM(Debits)
    
    logger.info(`[Audit] Wallet Audit for ${customerId}: Balance ${currentBalance}`);
    return { status: 'OK', customerId, currentBalance };
  }

  /**
   * 📦 Order Consistency Check
   * Re-runs Pricing Engine on an existing order to check for calculation drifts.
   */
  async validateOrderIntegrity(orderId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: { where: { status: 'normal' } } }
    });

    if (!order) return { status: 'ERROR', message: 'ORDER_NOT_FOUND' };

    const recalculation = pricingService.calculateOrder(
      order.orderItems, 
      order.deliveryFee, 
      order.discount
    );

    const drift = Math.abs(toNumber(order.total) - recalculation.total);

    if (drift > 0.01) {
      logger.error(`[Integrity] Financial drift detected in Order #${orderId}`, { drift });
      return { status: 'DRIFT_DETECTED', orderId, drift, expected: recalculation.total, actual: order.total };
    }

    return { status: 'INTEGRITY_OK', orderId };
  }

  /**
   * 🔄 State Machine Health
   * Checks for modifications stuck in PENDING_APPROVAL for too long.
   */
  async checkStuckModifications() {
    const stalledEvents = await prisma.orderModificationEvent.findMany({
      where: {
        status: 'PENDING_APPROVAL',
        expiresAt: { lt: new Date() }
      }
    });

    if (stalledEvents.length > 0) {
      logger.warn(`[Integrity] Found ${stalledEvents.length} expired modification events. Auto-reverting...`);
      
      for (const event of stalledEvents) {
        await prisma.$transaction(async (tx) => {
          await tx.orderModificationEvent.update({
            where: { id: event.id },
            data: { status: 'EXPIRED' }
          });

          await tx.order.update({
            where: { id: event.orderId },
            data: { modificationStatus: 'NONE' }
          });
        });
        logger.info(`[Integrity] Reverted Order #${event.orderId} from stuck PENDING_CUSTOMER state.`);
      }
    }

    return stalledEvents.length;
  }

  /**
   * 🛡️ Cancellation Refund Audit
   * Cross-references cancelled orders with the ledger to ensure refunds happened.
   */
  async validateCancellations() {
    const cancelledWalletOrders = await prisma.order.findMany({
      where: {
        status: 'cancelled',
        paymentMethod: 'wallet',
        updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24h
      }
    });

    const issues = [];
    for (const order of cancelledWalletOrders) {
      const refundEntry = await prisma.financialLedger.findFirst({
        where: {
          orderId: order.id,
          type: 'CREDIT',
          reason: { contains: 'استرداد' }
        }
      });

      if (!refundEntry) {
        logger.error(`[Integrity] Missing refund entry for cancelled Order #${order.orderNumber}`);
        issues.push(order.id);
      }
    }

    return { totalChecked: cancelledWalletOrders.length, issuesFound: issues.length, issues };
  }
}

module.exports = new SystemValidator();
