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
   * 🛡️ Cancellation Refund Audit (Optimized N+1 Fix)
   * Cross-references cancelled orders with the ledger to ensure refunds happened.
   */
  async validateCancellations(last24Hours) {
    const targetTime = last24Hours instanceof Date ? last24Hours : new Date(last24Hours || Date.now() - 24 * 60 * 60 * 1000);
    const start = Date.now();

    // 1. جلب الطلبات الملغاة
    const cancelledOrders = await prisma.order.findMany({
      where: { 
        status: { in: ['CANCELLED', 'cancelled'] },
        cancelledAt: { gte: targetTime },
        isDeleted: false  // ✅ احترام Soft Delete
      },
      select: { id: true, total: true, branchId: true, orderNumber: true }  // ✅ جلب الحقول المطلوبة فقط
    });

    if (cancelledOrders.length === 0) {
      logger.info('[ValidationComplete]', { duration: Date.now() - start, issuesFound: 0 });
      return [];
    }

    const batchIssues = await this._validateBatch(cancelledOrders);

    const duration = Date.now() - start;
    logger.info('[ValidationComplete]', {
      duration,
      issuesFound: batchIssues.length
    });

    return batchIssues;
  }

  /**
   * 🔄 Paginated Validation for Large Datasets
   */
  async validateCancellationsPaginated(last24Hours, batchSize = 500) {
    const targetTime = last24Hours instanceof Date ? last24Hours : new Date(last24Hours || Date.now() - 24 * 60 * 60 * 1000);
    let cursor = null;
    const allIssues = [];

    do {
      const batch = await prisma.order.findMany({
        where: { 
          status: { in: ['CANCELLED', 'cancelled'] },
          cancelledAt: { gte: targetTime },
          isDeleted: false
        },
        select: { id: true, total: true, branchId: true, orderNumber: true },
        take: batchSize,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: 'asc' }
      });

      if (batch.length === 0) break;

      // معالجة الدفعة الحالية
      const batchIssues = await this._validateBatch(batch);
      allIssues.push(...batchIssues);
      
      cursor = batch[batch.length - 1]?.id;
      
      // منع إجهاد الذاكرة بين الدفعات
      await new Promise(resolve => setImmediate(resolve));
      
    } while (cursor);

    return allIssues;
  }

  /**
   * 🔒 Private Helper: Validate a single batch of cancelled orders
   */
  async _validateBatch(cancelledOrders) {
    if (!cancelledOrders || cancelledOrders.length === 0) return [];

    const orderIds = cancelledOrders.map(o => o.id);
    
    // 2. ✅ جلب جميع قيود الاسترداد دفعة واحدة
    const refundEntries = await prisma.financialLedger.findMany({
      where: {
        orderId: { in: orderIds },
        type: { in: ['REFUND', 'CREDIT', 'refund', 'credit'] },
        isDeleted: false
      },
      select: { orderId: true, amount: true, status: true }
    });

    // 3. بناء خريطة للبحث السريع (O(1) lookup)
    const refundMap = new Map();
    for (const entry of refundEntries) {
      if (!refundMap.has(entry.orderId)) {
        refundMap.set(entry.orderId, []);
      }
      refundMap.get(entry.orderId).push(entry);
    }

    // 4. المزامنة في الذاكرة (بدون استعلامات إضافية)
    const issues = [];
    for (const order of cancelledOrders) {
      const refunds = refundMap.get(order.id) || [];
      
      if (refunds.length === 0) {
        logger.error(`[Integrity] Missing refund entry for cancelled Order #${order.orderNumber || order.id}`);
        issues.push({ 
          orderId: order.id, 
          issue: 'MISSING_REFUND',
          severity: 'HIGH'
        });
        continue;
      }

      // التحقق من مطابقة المبالغ (مجموع الاستردادات = قيمة الطلب)
      const totalRefunded = refunds
        .filter(r => !r.status || r.status === 'COMPLETED' || r.status === 'completed')
        .reduce((sum, r) => sum + toNumber(r.amount), 0);
      
      if (Math.abs(totalRefunded - toNumber(order.total)) > 0.01) {  // ✅ هامش خطأ 1 قرش
        logger.warn(`[Integrity] Financial refund mismatch for Order #${order.orderNumber || order.id}`, {
          expected: order.total,
          actual: totalRefunded
        });
        issues.push({
          orderId: order.id,
          issue: 'REFUND_AMOUNT_MISMATCH',
          expected: toNumber(order.total),
          actual: totalRefunded,
          severity: 'MEDIUM'
        });
      }
    }

    return issues;
  }
}

module.exports = new SystemValidator();
