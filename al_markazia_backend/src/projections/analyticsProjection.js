/**
 * 📈 Analytics Projection
 * Builds real-time business metrics by aggregating events.
 * Zero Database reads during calculation.
 */

const { toNumber } = require('../utils/number');

let metrics = {
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
  lastUpdated: new Date()
};

function isRevenueStatus(status) {
  return ['confirmed', 'preparing', 'ready', 'in_route', 'delivered'].includes(status);
}

function handleCreated(payload) {
  metrics.revenue.orderCount += 1;
  metrics.statusDistribution.pending += 1;
  metrics.typeDistribution[payload.orderType || 'takeaway'] += 1;
  metrics.lastUpdated = new Date();
}

function handleStatusChange(payload) {
  const { previousStatus, newStatus, order } = payload;
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
}

const prisma = require('../lib/prisma');

async function replay() {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: todayStart } },
    select: { total: true, status: true, orderType: true, subtotal: true, deliveryFee: true }
  });

  reset();
  
  for (const order of orders) {
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
  }
  
  metrics.lastUpdated = new Date();
}

function reset() {
  metrics.revenue = { live: 0, real: 0, orderCount: 0, liveOrderCount: 0, delivery: 0, takeaway: 0, deliveryFees: 0 };
  metrics.statusDistribution = { pending: 0, confirmed: 0, preparing: 0, ready: 0, in_route: 0, delivered: 0, cancelled: 0, waiting_cancellation: 0 };
  metrics.typeDistribution = { delivery: 0, takeaway: 0, dine_in: 0 };
  metrics.lastUpdated = new Date();
}

module.exports = {
  handleCreated,
  handleStatusChange,
  reset,
  replay,
  getMetrics: () => ({ ...metrics }),
};
