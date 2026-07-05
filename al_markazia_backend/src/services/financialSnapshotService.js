const { DateTime } = require('luxon');
const logger = require('../utils/logger');
const { DEFAULT_TIMEZONE } = require('../config/constants');

/**
 * 🏛️ Financial Snapshot Service
 * Purpose: Generates immutable daily financial baselines for reporting.
 * Rule: Snapshots are derived from Order + Ledger data.
 */
class FinancialSnapshotService {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.aggregator = container.financialAggregatorService;
  }

  /**
   * ❄️ Freeze Day Snapshot
   * Generates and stores the final financial state for a branch/day.
   */
  async createDailySnapshot(branchId, date) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { timezone: true }
    });
    const tz = branch?.timezone || DEFAULT_TIMEZONE;
    const targetDate = DateTime.fromJSDate(date).setZone(tz).startOf('day').toJSDate();

    // 1. Check if already exists and frozen
    const existing = await this.prisma.dailyFinancialSnapshot.findUnique({
      where: {
        date_branchId: { date: targetDate, branchId }
      }
    });

    if (existing && existing.isFrozen) {
      this.logger.info(`[Snapshot] IMMUTABILITY_GUARD: Skipping update for frozen snapshot | Branch: ${branchId} | Date: ${targetDate.toISOString()}`);
      return existing;
    }

    // 2. Fetch Fresh Aggregates from Aggregator
    const metrics = await this.aggregator.aggregateBranchData(branchId, targetDate, targetDate);

    // 3. Persist to DB (Atomic Upsert)
    // 🛡️ If the snapshot was NOT frozen, we allow one final "freeze" write.
    return await this.prisma.dailyFinancialSnapshot.upsert({
      where: {
        date_branchId: { date: targetDate, branchId }
      },
      update: {
        totalRevenue: metrics.grossRevenue,
        netRevenue: metrics.netRevenue,
        taxTotal: metrics.taxTotal,
        discountTotal: metrics.totalDiscounts,
        deliveryTotal: metrics.deliveryTotal,
        baseRevenue: metrics.baseRevenue,
        orderCount: metrics.orderCount,
        cancelledCount: metrics.cancelledCount,
        lossTotal: metrics.totalLoss,
        isFrozen: true 
      },
      create: {
        date: targetDate,
        branchId,
        totalRevenue: metrics.grossRevenue,
        netRevenue: metrics.netRevenue,
        taxTotal: metrics.taxTotal,
        discountTotal: metrics.totalDiscounts,
        deliveryTotal: metrics.deliveryTotal,
        baseRevenue: metrics.baseRevenue,
        orderCount: metrics.orderCount,
        cancelledCount: metrics.cancelledCount,
        lossTotal: metrics.totalLoss,
        isFrozen: true
      }
    });
  }

  /**
   * 🚀 Batch Process Nightly Snapshots
   */
  async processNightlyBatch(date = null) {
    const targetDate = date || DateTime.now().setZone(DEFAULT_TIMEZONE).minus({ days: 1 }).toJSDate();
    
    const branches = await this.prisma.branch.findMany({
      where: { isActive: true, isDeleted: false },
      select: { id: true }
    });

    logger.info(`[Snapshot] Starting nightly batch for ${targetDate.toISOString()} across ${branches.length} branches`);

    for (const branch of branches) {
      try {
        await this.createDailySnapshot(branch.id, targetDate);
      } catch (err) {
        logger.error(`[Snapshot] Failed for branch ${branch.id}`, { error: err.message });
      }
    }
  }

  /**
   * 📈 Get Historical Trend (Using Snapshots)
   * This is much faster than aggregating raw orders for long periods.
   */
  async getTrend(branchId, days = 30) {
    let tz = DEFAULT_TIMEZONE;
    if (branchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: branchId },
        select: { timezone: true }
      });
      if (branch?.timezone) tz = branch.timezone;
    }
    const end = DateTime.now().setZone(tz).startOf('day').toJSDate();
    const start = DateTime.now().setZone(tz).minus({ days }).startOf('day').toJSDate();

    return await this.prisma.dailyFinancialSnapshot.findMany({
      where: {
        branchId: branchId || undefined,
        date: { gte: start, lte: end }
      },
      orderBy: { date: 'asc' }
    });
  }
}

module.exports = FinancialSnapshotService;
