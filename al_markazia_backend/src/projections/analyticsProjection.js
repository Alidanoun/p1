/**
 * 📈 Analytics Projection
 * Builds real-time business metrics by aggregating events.
 * Zero Database reads during calculation.
 */

const { toNumber } = require('../utils/number');

const branchMap = new Map();

function getInitialMetrics() {
  return {
    revenue: {
      live: 0,
      real: 0,
      orderCount: 0,
      liveOrderCount: 0,
      delivery: 0,
      takeaway: 0,
      deliveryFees: 0
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
  if (!branchId) return null;
  if (!branchMap.has(branchId)) {
    branchMap.set(branchId, getInitialMetrics());
  }
  return branchMap.get(branchId);
}

function getGlobalMetrics() {
  const global = getInitialMetrics();
  for (const metrics of branchMap.values()) {
    global.revenue.live += metrics.revenue.live;
    global.revenue.real += metrics.revenue.real;
    global.revenue.orderCount += metrics.revenue.orderCount;
    global.revenue.liveOrderCount += metrics.revenue.liveOrderCount;
    global.revenue.delivery += metrics.revenue.delivery;
    global.revenue.takeaway += metrics.revenue.takeaway;
    global.revenue.deliveryFees += metrics.revenue.deliveryFees;

    Object.keys(global.statusDistribution).forEach(status => {
      global.statusDistribution[status] += (metrics.statusDistribution[status] || 0);
    });

    Object.keys(global.typeDistribution).forEach(type => {
      global.typeDistribution[type] += (metrics.typeDistribution[type] || 0);
    });
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

  metrics.revenue.orderCount += 1;
  metrics.statusDistribution.pending += 1;
  metrics.typeDistribution[payload.orderType || 'takeaway'] += 1;
  metrics.lastUpdated = new Date();
  metrics.sequence += 1;
}

function handleStatusChange(payload) {
  const { previousStatus, newStatus, order } = payload;
  const metrics = getBranchMetrics(order.branchId);
  if (!metrics) return;

  const amount = toNumber(order.total || 0);

  // 1. Update Distribution
  if (previousStatus && metrics.statusDistribution[previousStatus] > 0) {
    metrics.statusDistribution[previousStatus] -= 1;
  }
  metrics.statusDistribution[newStatus] = (metrics.statusDistribution[newStatus] || 0) + 1;

  // 2. Revenue Logic
  const wasRevenue = isRevenueStatus(previousStatus);
  const isRevenue = isRevenueStatus(newStatus);

  if (!wasRevenue && isRevenue) {
    metrics.revenue.live += amount;
    metrics.revenue.liveOrderCount += 1;
    
    if (order.orderType === 'delivery') {
        metrics.revenue.delivery += toNumber(order.subtotal || 0);
        metrics.revenue.deliveryFees += toNumber(order.deliveryFee || 0);
    } else {
        metrics.revenue.takeaway += toNumber(order.subtotal || 0);
    }
  } 
  else if (wasRevenue && !isRevenue) {
    metrics.revenue.live -= amount;
    metrics.revenue.liveOrderCount = Math.max(0, metrics.revenue.liveOrderCount - 1);
  }

  if (newStatus === 'delivered') {
    metrics.revenue.real += amount;
  }

  metrics.lastUpdated = new Date();
  metrics.sequence += 1;
}

const prisma = require('../lib/prisma');

async function replay() {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const orders = await prisma.order.findMany({
    where: { 
        createdAt: { gte: todayStart },
        isDeleted: false
    },
    select: { branchId: true, total: true, status: true, orderType: true, subtotal: true, deliveryFee: true }
  });

  reset();
  
  for (const order of orders) {
    const metrics = getBranchMetrics(order.branchId);
    if (!metrics) continue;

    metrics.revenue.orderCount += 1;
    metrics.statusDistribution[order.status] = (metrics.statusDistribution[order.status] || 0) + 1;
    metrics.typeDistribution[order.orderType || 'takeaway'] += 1;

    if (isRevenueStatus(order.status)) {
        const amount = toNumber(order.total || 0);
        metrics.revenue.live += amount;
        metrics.revenue.liveOrderCount += 1;
        
        if (order.orderType === 'delivery') {
            metrics.revenue.delivery += toNumber(order.subtotal || 0);
            metrics.revenue.deliveryFees += toNumber(order.deliveryFee || 0);
        } else {
            metrics.revenue.takeaway += toNumber(order.subtotal || 0);
        }

        if (order.status === 'delivered') {
            metrics.revenue.real += amount;
        }
    }
    metrics.sequence += 1;
  }
}

function reset() {
  branchMap.clear();
}

module.exports = {
  handleCreated,
  handleStatusChange,
  reset,
  replay,
  getMetrics: (branchId) => branchId ? getBranchMetrics(branchId) : getGlobalMetrics(),
};
