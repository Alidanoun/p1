const { DateTime } = require('luxon');
const { toDecimal, Decimal } = require('../utils/number');
const accountingService = require('./accountingService');
const { DEFAULT_TIMEZONE } = require('../config/constants');

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
    this.DEFAULT_TZ = DEFAULT_TIMEZONE;
  }

  /**
   * 🧮 Aggregate Branch Data for a Period
   */
  async aggregateBranchData(branchId, startDate, endDate) {
    let tz = this.DEFAULT_TZ;
    if (branchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: branchId },
        select: { timezone: true }
      });
      if (branch?.timezone) tz = branch.timezone;
    }

    const start = DateTime.fromJSDate(startDate).setZone(tz).startOf('day').toJSDate();
    const end = DateTime.fromJSDate(endDate).setZone(tz).endOf('day').toJSDate();

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
        subtotal: true,
        deliveryFee: true,
        tax: true,
        discount: true,
        total: true
      }
    });

    // 2. Refund Aggregates
    const refundAggs = await this.prisma.orderCancellation.aggregate({
      where: {
        createdAt: { gte: start, lte: end },
        order: { branchId: branchId || undefined, isDeleted: false }
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
      { 
        count: orderAggs._count.id,
        subtotal: orderAggs._sum.subtotal,
        deliveryFee: orderAggs._sum.deliveryFee,
        tax: orderAggs._sum.tax,
        discount: orderAggs._sum.discount,
        total: orderAggs._sum.total 
      },
      { total: refundAggs._sum.refundedAmount },
      { count: cancellationAggs._count.id, totalLoss: cancellationAggs._sum.total }
    );
  }

  /**
   * 📅 Aggregate Daily Stats for ALL branches
   * Used for nightly snapshot generation.
   */
  async aggregateDailyGlobal(date) {
    // We compute the system-wide baseline dayStart for the return object
    const dayStart = DateTime.fromJSDate(date).setZone(this.DEFAULT_TZ).startOf('day').toJSDate();

    // Fetch all active branches
    const branches = await this.prisma.branch.findMany({
      where: { isActive: true, isDeleted: false },
      select: { id: true }
    });

    const results = [];
    for (const branch of branches) {
      // Pass the raw date so each branch aggregates based on its own timezone boundaries
      const metrics = await this.aggregateBranchData(branch.id, date, date);
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
    let platformDelivery = new Decimal(0);
    let platformBase = new Decimal(0);
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
      platformDelivery = platformDelivery.plus(toDecimal(metrics.deliveryTotal || 0));
      platformBase = platformBase.plus(toDecimal(metrics.baseRevenue || 0));
      platformOrders += metrics.orderCount;
    }

    return {
      overview: {
        totalGross: platformGross.toNumber(),
        totalNet: platformNet.toNumber(),
        totalTax: platformTax.toNumber(),
        totalDiscounts: platformDiscounts.toNumber(),
        totalDelivery: platformDelivery.toNumber(),
        totalBase: platformBase.toNumber(),
        totalOrders: platformOrders,
        branchCount: branches.length
      },
      branches: branchBreakdown,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = FinancialAggregatorService;
