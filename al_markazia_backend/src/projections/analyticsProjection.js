const { DateTime } = require('luxon');
const { toNumber, toMoney } = require('../utils/number');
const accountingService = require('../services/accountingService');

const branchMap = new Map();
let activeBranchIds = new Set();

function getInitialMetrics() {
  return {
    financials: {
      grossRevenue: 0,   // الحقيقة المالية (Source of Truth from DB)
      netRevenue: 0,
      taxTotal: 0,
      deliveryTotal: 0,
      discountTotal: 0,
      cancelledTotal: 0,
      avgTicket: 0
    },
    counts: {
      total: 0,
      delivered: 0,
      cancelled: 0,
      active: 0
    },
    statusDistribution: {
      pending: 0,
      confirmed: 0,
      preparing: 0,
      ready: 0,
      in_route: 0,
      delivered: 0,
      cancelled: 0,
      waiting_cancellation: 0
    },
    typeDistribution: {
      delivery: 0,
      takeaway: 0,
      dine_in: 0
    },
    lastUpdated: new Date(),
    sequence: 0
  };
}

function getBranchMetrics(branchId) {
  const key = branchId || 'SYSTEM_DEFAULT';
  if (!branchMap.has(key)) {
    branchMap.set(key, getInitialMetrics());
  }
  return branchMap.get(key);
}

function getGlobalMetrics() {
  const global = getInitialMetrics();
  
  for (const [branchId, metrics] of branchMap.entries()) {
    if (branchId === 'SYSTEM_DEFAULT') continue;
    if (!activeBranchIds.has(branchId)) continue;

    // Aggregate Financials with Rounding Safety
    global.financials.grossRevenue = toMoney(global.financials.grossRevenue + metrics.financials.grossRevenue);
    global.financials.netRevenue = toMoney(global.financials.netRevenue + metrics.financials.netRevenue);
    global.financials.taxTotal = toMoney(global.financials.taxTotal + metrics.financials.taxTotal);
    global.financials.deliveryTotal = toMoney(global.financials.deliveryTotal + metrics.financials.deliveryTotal);
    global.financials.discountTotal = toMoney(global.financials.discountTotal + metrics.financials.discountTotal);
    global.financials.cancelledTotal = toMoney(global.financials.cancelledTotal + metrics.financials.cancelledTotal);

    global.counts.total += metrics.counts.total;
    global.counts.delivered += metrics.counts.delivered;
    global.counts.cancelled += metrics.counts.cancelled;
    global.counts.active += metrics.counts.active;

    Object.keys(global.statusDistribution).forEach(status => {
      global.statusDistribution[status] += (metrics.statusDistribution[status] || 0);
    });

    Object.keys(global.typeDistribution).forEach(type => {
      global.typeDistribution[type] += (metrics.typeDistribution[type] || 0);
    });
  }

  if (global.counts.delivered > 0) {
    global.financials.avgTicket = toMoney(global.financials.grossRevenue / global.counts.delivered);
  }

  global.lastUpdated = new Date();
  return global;
}

function isRevenueStatus(status) {
  // 🏢 Deterministic Rule: Financial revenue is ONLY 'delivered'
  return status === 'delivered';
}

/**
 * 💰 Financial Synchronizer (Deterministic)
 * Directly aggregates financial data from the DB to prevent race conditions.
 */
async function syncFinancials(branchId) {
  const prisma = require('../lib/prisma');
  const ammanNow = DateTime.now().setZone('Asia/Amman');
  const ammanStartOfDay = ammanNow.startOf('day').toJSDate();

  const metrics = getBranchMetrics(branchId);
  if (!metrics) return;

  const deliveredOrders = await prisma.order.findMany({
    where: {
      branchId,
      status: 'delivered',
      createdAt: { gte: ammanStartOfDay },
      isDeleted: false
    },
    select: { total: true, subtotal: true, deliveryFee: true, discount: true }
  });

  const cancelledOrders = await prisma.order.findMany({
    where: {
      branchId,
      status: 'cancelled',
      createdAt: { gte: ammanStartOfDay },
      isDeleted: false
    },
    select: { total: true }
  });

  // Reset financials
  metrics.financials = getInitialMetrics().financials;

  for (const order of deliveredOrders) {
    const subtotal = toNumber(order.subtotal || 0);
    const { base, tax } = accountingService.extractTax(subtotal);
    const total = toNumber(order.total || 0);
    const discount = toNumber(order.discount || 0);
    const deliveryFee = toNumber(order.deliveryFee || 0);
    const netRevenue = toMoney(base - discount);

    metrics.financials.grossRevenue = toMoney(metrics.financials.grossRevenue + total);
    metrics.financials.netRevenue = toMoney(metrics.financials.netRevenue + netRevenue);
    metrics.financials.taxTotal = toMoney(metrics.financials.taxTotal + tax);
    metrics.financials.deliveryTotal = toMoney(metrics.financials.deliveryTotal + deliveryFee);
    metrics.financials.discountTotal = toMoney(metrics.financials.discountTotal + discount);
  }

  metrics.financials.cancelledTotal = cancelledOrders.reduce((sum, o) => toMoney(sum + toNumber(o.total)), 0);
  metrics.counts.delivered = deliveredOrders.length;
  metrics.counts.cancelled = cancelledOrders.length;

  if (metrics.counts.delivered > 0) {
    metrics.financials.avgTicket = toMoney(metrics.financials.grossRevenue / metrics.counts.delivered);
  }

  metrics.lastUpdated = new Date();
  metrics.sequence += 1;
}

function handleCreated(payload) {
  const metrics = getBranchMetrics(payload.branchId);
  if (!metrics) return;

  metrics.counts.total += 1;
  metrics.counts.active += 1;
  metrics.statusDistribution.pending += 1;
  metrics.typeDistribution[payload.orderType || 'takeaway'] += 1;
  metrics.lastUpdated = new Date();
  metrics.sequence += 1;
}

function handleModified(payload) {
  const { order } = payload;
  // Any modification to a finalized order requires a financial sync
  if (isRevenueStatus(order.status) || order.status === 'cancelled') {
    syncFinancials(order.branchId);
  }
}

function handleStatusChange(payload) {
  const { previousStatus, newStatus, order } = payload;
  const metrics = getBranchMetrics(order.branchId);
  if (!metrics) return;

  // 1. Update Distribution (Live Stats - Approximate)
  if (previousStatus && metrics.statusDistribution[previousStatus] > 0) {
    metrics.statusDistribution[previousStatus] -= 1;
  }
  metrics.statusDistribution[newStatus] = (metrics.statusDistribution[newStatus] || 0) + 1;

  // 2. Manage Active Count
  if (previousStatus === 'pending' || previousStatus === 'confirmed' || previousStatus === 'preparing' || previousStatus === 'ready' || previousStatus === 'in_route') {
    if (newStatus === 'delivered' || newStatus === 'cancelled') {
      metrics.counts.active = Math.max(0, metrics.counts.active - 1);
    }
  }

  // 3. 💰 Trigger Financial Reconciliation on Terminal States
  if (newStatus === 'delivered' || newStatus === 'cancelled' || previousStatus === 'delivered' || previousStatus === 'cancelled') {
    syncFinancials(order.branchId);
  }

  metrics.lastUpdated = new Date();
  metrics.sequence += 1;
}

const prisma = require('../lib/prisma');

async function replay(targetBranchId = null) {
  const ammanNow = DateTime.now().setZone('Asia/Amman');
  const ammanStartOfDay = ammanNow.startOf('day').toJSDate();

  if (!targetBranchId) {
    const activeBranches = await prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true }
    });
    activeBranchIds = new Set(activeBranches.map(b => b.id));
    reset();
  }

  const branchesToProcess = targetBranchId ? [targetBranchId] : Array.from(activeBranchIds);

  for (const bid of branchesToProcess) {
    const orders = await prisma.order.findMany({
      where: { 
          branchId: bid,
          createdAt: { gte: ammanStartOfDay },
          isDeleted: false
      },
      select: { total: true, status: true, orderType: true, subtotal: true, deliveryFee: true, discount: true, tax: true }
    });

    const metrics = getBranchMetrics(bid);
    // Reset non-financials (Financials will be synced via syncFinancials or logic below)
    metrics.counts.total = 0;
    metrics.counts.active = 0;
    Object.keys(metrics.statusDistribution).forEach(k => metrics.statusDistribution[k] = 0);
    Object.keys(metrics.typeDistribution).forEach(k => metrics.typeDistribution[k] = 0);

    for (const order of orders) {
      metrics.counts.total += 1;
      metrics.statusDistribution[order.status] = (metrics.statusDistribution[order.status] || 0) + 1;
      metrics.typeDistribution[order.orderType || 'takeaway'] += 1;

      if (!['delivered', 'cancelled'].includes(order.status)) {
        metrics.counts.active += 1;
      }
    }
    
    // 💰 Force Financial Sync from DB
    await syncFinancials(bid);
  }
}

function reset() {
  branchMap.clear();
}

// 🏥 Periodic Financial Reconciliation Job (Every 5 minutes)
setInterval(() => {
  console.log('🔄 [FinancialEngine] Running periodic reconciliation...');
  replay().catch(err => console.error('[FinancialEngine] Reconciliation failed', err));
}, 5 * 60 * 1000);

module.exports = {
  handleCreated,
  handleModified,
  handleStatusChange,
  reset,
  replay,
  syncFinancials,
  getMetrics: (branchId) => branchId ? getBranchMetrics(branchId) : getGlobalMetrics(),
};
