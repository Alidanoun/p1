const { DateTime } = require('luxon');
const { toDecimal, Decimal } = require('../utils/number');
const accountingService = require('./accountingService');

/**
 * 🏛️ Financial Aggregator Service
 * Purpose: Advanced DB-level aggregations for live reporting and snapshots.
 * Ensures strict consistency between different reporting layers.
 */
class FinancialAggregatorService {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
    this.DEFAULT_TZ = 'Asia/Amman';
  }

  /**
   * 🧮 Aggregate Branch Data for a Period
   */
  async aggregateBranchData(branchId, startDate, endDate) {
    const start = DateTime.fromJSDate(startDate).setZone(this.DEFAULT_TZ).startOf('day').toJSDate();
    const end = DateTime.fromJSDate(endDate).setZone(this.DEFAULT_TZ).endOf('day').toJSDate();

    const whereBase = {
      createdAt: { gte: start, lte: end },
      branchId: branchId || undefined,
      isDeleted: false
    };

    // 1. Order Aggregates (Valid Orders)
    const orderAggs = await this.prisma.order.aggregate({
      where: {
        ...whereBase,
        status: { not: 'cancelled' }
      },
      _count: { id: true },
      _sum: { 
        total: true,
        discount: true
      }
    });

    // 2. Refund Aggregates
    const refundAggs = await this.prisma.orderCancellation.aggregate({
      where: {
        createdAt: { gte: start, lte: end },
        order: { branchId: branchId || undefined }
      },
      _sum: { refundedAmount: true }
    });

    // 3. Cancellation Aggregates (Loss Metrics)
    const cancellationAggs = await this.prisma.order.aggregate({
      where: {
        ...whereBase,
        status: 'cancelled'
      },
      _count: { id: true },
      _sum: { total: true }
    });

    // 4. Transform using Canonical Definitions
    return accountingService.calculateFinancialMetrics(
      { total: orderAggs._sum.total, count: orderAggs._count.id },
      { total: refundAggs._sum.refundedAmount },
      { total: orderAggs._sum.discount },
      { count: cancellationAggs._count.id, totalLoss: cancellationAggs._sum.total }
    );
  }

  /**
   * 📅 Aggregate Daily Stats for ALL branches
   * Used for nightly snapshot generation.
   */
  async aggregateDailyGlobal(date) {
    const dayStart = DateTime.fromJSDate(date).setZone(this.DEFAULT_TZ).startOf('day').toJSDate();
    const dayEnd = DateTime.fromJSDate(date).setZone(this.DEFAULT_TZ).endOf('day').toJSDate();

    // Fetch all active branches
    const branches = await this.prisma.branch.findMany({
      where: { isActive: true, isDeleted: false },
      select: { id: true }
    });

    const results = [];
    for (const branch of branches) {
      const metrics = await this.aggregateBranchData(branch.id, dayStart, dayEnd);
      results.push({
        branchId: branch.id,
        date: dayStart,
        ...metrics
      });
    }

    return results;
  }

  /**
   * 🌎 Global Platform Summary
   * Aggregates financial performance across ALL branches.
   */
  async getGlobalFinancialSummary(startDate, endDate) {
    const branches = await this.prisma.branch.findMany({
      where: { isActive: true, isDeleted: false },
      select: { id: true, name: true }
    });

    const branchBreakdown = [];
    let platformGross = new Decimal(0);
    let platformNet = new Decimal(0);
    let platformTax = new Decimal(0);
    let platformDiscounts = new Decimal(0);
    let platformOrders = 0;

    for (const branch of branches) {
      const metrics = await this.aggregateBranchData(branch.id, startDate, endDate);
      
      branchBreakdown.push({
        branchId: branch.id,
        branchName: branch.name,
        ...metrics
      });

      platformGross = platformGross.plus(toDecimal(metrics.grossRevenue));
      platformNet = platformNet.plus(toDecimal(metrics.netRevenue));
      platformTax = platformTax.plus(toDecimal(metrics.taxTotal));
      platformDiscounts = platformDiscounts.plus(toDecimal(metrics.totalDiscounts));
      platformOrders += metrics.orderCount;
    }

    return {
      overview: {
        totalGross: platformGross.toNumber(),
        totalNet: platformNet.toNumber(),
        totalTax: platformTax.toNumber(),
        totalDiscounts: platformDiscounts.toNumber(),
        totalOrders: platformOrders,
        branchCount: branches.length
      },
      branches: branchBreakdown,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = FinancialAggregatorService;
