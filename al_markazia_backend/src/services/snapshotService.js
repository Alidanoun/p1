const prisma = require('../lib/prisma');
const { toNumber } = require('../utils/number');
const logger = require('../utils/logger');

/**
 * 🧊 Daily Financial Snapshot Service
 * Ensures historical reports are immutable and accurate.
 */
class SnapshotService {

  /**
   * 📸 Freeze Daily Financials
   * Should be called via Cron at 11:59 PM or manually by Admin.
   */
  async createDailySnapshot(dateStr, branchId = null) {
    const targetDate = new Date(dateStr);
    targetDate.setHours(0, 0, 0, 0);
    const nextDate = new Date(targetDate);
    nextDate.setDate(targetDate.getDate() + 1);

    return await prisma.$transaction(async (tx) => {
      // 1. Check if already frozen
      const existing = await tx.dailyFinancialSnapshot.findFirst({
        where: { date: targetDate, branchId }
      });
      if (existing) throw new Error('DAY_ALREADY_FROZEN');

      // 2. Aggregate Data for the day
      const where = {
        createdAt: { gte: targetDate, lt: nextDate },
        branchId: branchId
      };

      const [orderAgg, deliveredCount, cancelledCount, lossAgg, ledgerAgg] = await Promise.all([
        tx.order.aggregate({
          where: { ...where, status: 'delivered' },
          _sum: { total: true, subtotal: true, tax: true, discount: true },
          _count: { id: true }
        }),
        tx.order.count({ where: { ...where, status: 'delivered' } }),
        tx.order.count({ where: { ...where, status: 'cancelled' } }),
        tx.order.aggregate({
          where: { ...where, status: 'cancelled' },
          _sum: { subtotal: true } // Subtotal before cancellation
        }),
        tx.financialLedger.aggregate({
          where,
          _sum: { amount: true }
        })
      ]);

      // 🔍 [INTEGRITY-CHECK] Compare Orders vs Ledger
      const totalFromOrders = toNumber(orderAgg._sum.total);
      const totalFromLedger = toNumber(ledgerAgg._sum.amount); // Simplification

      // Create Snapshot
      const snapshot = await tx.dailyFinancialSnapshot.create({
        data: {
          date: targetDate,
          branchId,
          totalRevenue: totalFromOrders,
          netRevenue: toNumber(orderAgg._sum.subtotal),
          taxTotal: toNumber(orderAgg._sum.tax),
          discountTotal: toNumber(orderAgg._sum.discount),
          orderCount: orderAgg._count.id,
          cancelledCount: cancelledCount,
          lossTotal: toNumber(lossAgg._sum.subtotal),
          isFrozen: true
        }
      });

      // 🚨 [ALERTS] Raise critical alert if data drift detected
      if (Math.abs(totalFromOrders - totalFromLedger) > 0.1) {
         await tx.notification.create({
           data: {
             title: '🚨 تضارب مالي خطير!',
             message: `اكتشاف فرق بين سجل الأستاذ والطلبات في يوم ${dateStr}. الفرق: ${Math.abs(totalFromOrders - totalFromLedger)}`,
             severity: 'CRITICAL',
             alertType: 'FINANCIAL_DRIFT',
             status: 'PENDING'
           }
         });
      }

      logger.info('❄️ DAILY_SNAPSHOT_CREATED', { date: dateStr, branchId, snapshotId: snapshot.id });
      return snapshot;
    });
  }

  /**
   * 🏗️ Rebuild Analytics from Ledger (The Truth Source)
   * This is for "Production Hardening Day" testing.
   */
  async rebuildDayFromLedger(dateStr) {
    const targetDate = new Date(dateStr);
    targetDate.setHours(0, 0, 0, 0);
    const nextDate = new Date(targetDate);
    nextDate.setDate(targetDate.getDate() + 1);

    const ledgerEntries = await prisma.financialLedger.findMany({
      where: { createdAt: { gte: targetDate, lt: nextDate } }
    });

    const reconstruction = ledgerEntries.reduce((acc, entry) => {
      if (entry.type === 'CREDIT') acc.total += toNumber(entry.amount);
      else acc.total -= toNumber(entry.amount);
      return acc;
    }, { total: 0 });

    return reconstruction;
  }
}

module.exports = new SnapshotService();
