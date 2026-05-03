const { DateTime } = require('luxon');
const { toNumber, toMoney } = require('../utils/number');
const accountingService = require('../services/accountingService');

const branchMap = new Map();
let activeBranchIds = new Set();

function getInitialMetrics() {
  return {
    financials: {
      grossRevenue: 0,   // الإجمالي شامل كل شيء (Subtotal + Delivery - Discount)
      netRevenue: 0,     // الصافي (Base - Discount)
      taxTotal: 0,       // إجمالي الضرائب المستخرجة (16%)
      deliveryTotal: 0,  // إجمالي رسوم التوصيل
      discountTotal: 0,  // إجمالي الخصومات
      cancelledTotal: 0, // التسرب المالي (الطلبات الملغية)
      avgTicket: 0       // متوسط قيمة الفاتورة الناجحة
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
  return ['confirmed', 'preparing', 'ready', 'in_route', 'delivered'].includes(status);
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

/**
 * 🛠️ [SAFETY-LAYER] Handle Order Modifications via AccountingService
 */
function handleModified(payload) {
  const { order, event } = payload;
  const metrics = getBranchMetrics(order.branchId);
  if (!metrics) return;

  const { oldSummary, newSummary } = event.payload;
  if (!oldSummary || !newSummary) return;

  if (isRevenueStatus(order.status)) {
    const { deltaTotal, deltaNet, deltaTax, deltaDelivery, deltaDiscount } = 
      accountingService.validateDelta(oldSummary, newSummary);

    metrics.financials.grossRevenue = toMoney(metrics.financials.grossRevenue + deltaTotal);
    metrics.financials.netRevenue = toMoney(metrics.financials.netRevenue + deltaNet);
    metrics.financials.taxTotal = toMoney(metrics.financials.taxTotal + deltaTax);
    metrics.financials.deliveryTotal = toMoney(metrics.financials.deliveryTotal + deltaDelivery);
    metrics.financials.discountTotal = toMoney(metrics.financials.discountTotal + deltaDiscount);
  }

  metrics.lastUpdated = new Date();
  metrics.sequence += 1;
}

function handleStatusChange(payload) {
  const { previousStatus, newStatus, order } = payload;
  const metrics = getBranchMetrics(order.branchId);
  if (!metrics) return;

  // 🛡️ Use AccountingService for all component extraction
  const summary = accountingService.calculateOrderSummary(
    [], // Mock items as we use the stored total/subtotal
    toNumber(order.deliveryFee),
    toNumber(order.discount)
  );
  
  // Actually, since we have subtotal, we extract tax from it directly
  const subtotal = toNumber(order.subtotal || 0);
  const { base, tax } = accountingService.extractTax(subtotal);
  const total = toNumber(order.total || 0);
  const discount = toNumber(order.discount || 0);
  const deliveryFee = toNumber(order.deliveryFee || 0);
  const netRevenue = toMoney(base - discount);

  if (previousStatus && metrics.statusDistribution[previousStatus] > 0) {
    metrics.statusDistribution[previousStatus] -= 1;
  }
  metrics.statusDistribution[newStatus] = (metrics.statusDistribution[newStatus] || 0) + 1;

  const wasRevenue = isRevenueStatus(previousStatus);
  const isRevenue = isRevenueStatus(newStatus);

  if (!wasRevenue && isRevenue) {
    metrics.financials.grossRevenue = toMoney(metrics.financials.grossRevenue + total);
    metrics.financials.netRevenue = toMoney(metrics.financials.netRevenue + netRevenue);
    metrics.financials.taxTotal = toMoney(metrics.financials.taxTotal + tax);
    metrics.financials.deliveryTotal = toMoney(metrics.financials.deliveryTotal + deliveryFee);
    metrics.financials.discountTotal = toMoney(metrics.financials.discountTotal + discount);
  } 
  else if (wasRevenue && !isRevenue) {
    metrics.financials.grossRevenue = toMoney(metrics.financials.grossRevenue - total);
    metrics.financials.netRevenue = toMoney(metrics.financials.netRevenue - netRevenue);
    metrics.financials.taxTotal = toMoney(metrics.financials.taxTotal - tax);
    metrics.financials.deliveryTotal = toMoney(metrics.financials.deliveryTotal - deliveryFee);
    metrics.financials.discountTotal = toMoney(metrics.financials.discountTotal - discount);
  }

  if (newStatus === 'delivered') {
    metrics.counts.delivered += 1;
    metrics.counts.active = Math.max(0, metrics.counts.active - 1);
  }

  if (newStatus === 'cancelled') {
    metrics.counts.cancelled += 1;
    metrics.counts.active = Math.max(0, metrics.counts.active - 1);
    if (wasRevenue) {
        metrics.financials.cancelledTotal = toMoney(metrics.financials.cancelledTotal + total);
    }
  }

  if (metrics.counts.delivered > 0) {
    metrics.financials.avgTicket = toMoney(metrics.financials.grossRevenue / metrics.counts.delivered);
  }

  metrics.lastUpdated = new Date();
  metrics.sequence += 1;
}

const prisma = require('../lib/prisma');

async function replay() {
  const ammanNow = DateTime.now().setZone('Asia/Amman');
  const ammanStartOfDay = ammanNow.startOf('day').toJSDate();

  const activeBranches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true }
  });
  activeBranchIds = new Set(activeBranches.map(b => b.id));

  const orders = await prisma.order.findMany({
    where: { 
        createdAt: { gte: ammanStartOfDay },
        isDeleted: false
    },
    select: { branchId: true, total: true, status: true, orderType: true, subtotal: true, deliveryFee: true, discount: true, tax: true }
  });

  reset();
  
  for (const order of orders) {
    if (!order.branchId || !activeBranchIds.has(order.branchId)) continue;

    const metrics = getBranchMetrics(order.branchId);
    
    // 🛡️ Tax-Inclusive Extraction for Replay
    const subtotal = toNumber(order.subtotal || 0);
    const { base, tax } = accountingService.extractTax(subtotal);
    const total = toNumber(order.total || 0);
    const discount = toNumber(order.discount || 0);
    const deliveryFee = toNumber(order.deliveryFee || 0);
    const netRevenue = toMoney(base - discount);

    metrics.counts.total += 1;
    metrics.statusDistribution[order.status] = (metrics.statusDistribution[order.status] || 0) + 1;
    metrics.typeDistribution[order.orderType || 'takeaway'] += 1;

    if (isRevenueStatus(order.status)) {
        metrics.financials.grossRevenue = toMoney(metrics.financials.grossRevenue + total);
        metrics.financials.netRevenue = toMoney(metrics.financials.netRevenue + netRevenue);
        metrics.financials.taxTotal = toMoney(metrics.financials.taxTotal + tax);
        metrics.financials.deliveryTotal = toMoney(metrics.financials.deliveryTotal + deliveryFee);
        metrics.financials.discountTotal = toMoney(metrics.financials.discountTotal + discount);

        if (order.status === 'delivered') {
            metrics.counts.delivered += 1;
        } else {
            metrics.counts.active += 1;
        }
    } else if (order.status === 'pending') {
        metrics.counts.active += 1;
    }

    if (order.status === 'cancelled') {
        metrics.counts.cancelled += 1;
        metrics.financials.cancelledTotal = toMoney(metrics.financials.cancelledTotal + total);
    }
  }

  for (const metrics of branchMap.values()) {
    if (metrics.counts.delivered > 0) {
      metrics.financials.avgTicket = toMoney(metrics.financials.grossRevenue / metrics.counts.delivered);
    }
  }
}

function reset() {
  branchMap.clear();
}

module.exports = {
  handleCreated,
  handleModified,
  handleStatusChange,
  reset,
  replay,
  getMetrics: (branchId) => branchId ? getBranchMetrics(branchId) : getGlobalMetrics(),
};
