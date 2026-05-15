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
    activityFeed: [],
    updatedAt: new Date(),
    version: 1,
    eventSequence: 0
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

  global.updatedAt = new Date();
  global.version = Math.max(...Array.from(branchMap.values()).map(m => m.version || 1));
  global.eventSequence = Math.max(...Array.from(branchMap.values()).map(m => m.eventSequence || 0));
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
    select: { total: true, subtotal: true, deliveryFee: true, discount: true },
    take: 500
  });

  const cancelledOrders = await prisma.order.findMany({
    where: {
      branchId,
      status: 'cancelled',
      createdAt: { gte: ammanStartOfDay },
      isDeleted: false
    },
    select: { total: true },
    take: 500
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

  metrics.updatedAt = new Date();
  metrics.version = (metrics.version || 0) + 1;
  metrics.eventSequence += 1;
}

// 🛡️ Option B Architecture: Idempotent Event-Application / State Reconstruction Model
// Authoritative in-memory snapshot tracking logical state of active orders for uncorrupted dynamic reconstruction
const activeOrdersMap = new Map();

function rebuildBranchMetrics(branchId) {
  const metrics = getBranchMetrics(branchId);
  if (!metrics) return;

  // 1. Reset live distribution counters and active count to pure uncorrupted zero
  metrics.counts.total = 0;
  metrics.counts.active = 0;
  Object.keys(metrics.statusDistribution).forEach(k => metrics.statusDistribution[k] = 0);
  Object.keys(metrics.typeDistribution).forEach(k => metrics.typeDistribution[k] = 0);

  // 2. Reconstruct completely in O(N) from authoritative active memory snapshots
  for (const snap of activeOrdersMap.values()) {
    if (snap.branchId === branchId) {
      metrics.counts.total += 1;
      const st = snap.status || 'pending';
      metrics.statusDistribution[st] = (metrics.statusDistribution[st] || 0) + 1;
      const ty = snap.orderType || 'takeaway';
      metrics.typeDistribution[ty] = (metrics.typeDistribution[ty] || 0) + 1;

      if (st !== 'delivered' && st !== 'cancelled') {
        metrics.counts.active += 1;
      }
    }
  }

  metrics.updatedAt = new Date();
  metrics.version = (metrics.version || 0) + 1;
  metrics.eventSequence += 1;
}

function pushActivityLog(branchId, order, action) {
  const metrics = getBranchMetrics(branchId);
  if (!metrics) return;
  if (!metrics.activityFeed) metrics.activityFeed = [];
  metrics.activityFeed.unshift({
    id: `${order.id}-${Date.now()}`,
    orderNumber: order.orderNumber,
    action,
    status: order.status,
    time: new Date()
  });
  if (metrics.activityFeed.length > 40) metrics.activityFeed.pop();
}

function broadcastUpdate(branchId) {
  try {
    const socketModule = require('../socket');
    if (socketModule.isReady && socketModule.isReady()) {
      const io = socketModule.getIO();
      const { SOCKET_ROOMS, SOCKET_EVENTS } = require('../shared/socketEvents');
      io.broadcastSmart(SOCKET_ROOMS.MONITOR_BRANCH(branchId), SOCKET_EVENTS.DASHBOARD_METRICS_UPDATE, module.exports.getMetrics(branchId));
      io.broadcastSmart(SOCKET_ROOMS.MONITOR_GLOBAL, SOCKET_EVENTS.DASHBOARD_METRICS_UPDATE, module.exports.getMetrics(null));
    }
  } catch (err) { /* silent safe execution */ }
}

function handleCreated(payload) {
  const order = payload?.order || payload;
  if (!order || !order.id) return;

  const orderId = String(order.id);
  const incomingVersion = order.version || 1;
  const existing = activeOrdersMap.get(orderId);

  // 🛡️ Monotonic Version Guard: Ignore stale created events/replays
  if (existing && existing.version >= incomingVersion) {
    return;
  }

  activeOrdersMap.set(orderId, {
    branchId: order.branchId,
    status: order.status || 'pending',
    orderType: order.orderType || 'takeaway',
    version: incomingVersion
  });

  rebuildBranchMetrics(order.branchId);
  pushActivityLog(order.branchId, order, 'تم إنشاء طلب جديد');
  broadcastUpdate(order.branchId);
}

async function handleModified(payload) {
  const order = payload?.order || payload;
  if (!order || !order.id) return;

  const orderId = String(order.id);
  const incomingVersion = order.version || 0;
  const existing = activeOrdersMap.get(orderId);

  if (existing && incomingVersion && existing.version >= incomingVersion) {
    return;
  }

  activeOrdersMap.set(orderId, {
    branchId: order.branchId || existing?.branchId,
    status: order.status || existing?.status || 'pending',
    orderType: order.orderType || existing?.orderType || 'takeaway',
    version: incomingVersion || existing?.version || 1
  });

  rebuildBranchMetrics(order.branchId || existing?.branchId);
  pushActivityLog(order.branchId || existing?.branchId, order, 'تعديل على الطلب');

  // Any modification to a finalized order requires a financial sync
  if (isRevenueStatus(order.status) || order.status === 'cancelled') {
    await syncFinancials(order.branchId);
  }
  broadcastUpdate(order.branchId || existing?.branchId);
}

async function handleStatusChange(payload) {
  const { order } = payload;
  if (!order || !order.id) return;

  const orderId = String(order.id);
  const incomingVersion = order.version || 0;
  const existing = activeOrdersMap.get(orderId);

  // 🛡️ Absolute Monotonic Idempotency Check: Drop stale network replays deterministically
  if (existing && existing.version >= incomingVersion) {
    return;
  }

  activeOrdersMap.set(orderId, {
    branchId: order.branchId || existing?.branchId,
    status: order.status,
    orderType: order.orderType || existing?.orderType || 'takeaway',
    version: incomingVersion
  });

  rebuildBranchMetrics(order.branchId || existing?.branchId);

  const statusAr = { confirmed: 'تأكيد الطلب', preparing: 'تجهيز الطلب', ready: 'الطلب جاهز', in_route: 'خرج للتوصيل', delivered: 'تم التسليم', cancelled: 'إلغاء الطلب' }[order.status] || order.status;
  pushActivityLog(order.branchId || existing?.branchId, order, `تحديث الحالة: ${statusAr}`);

  // 💰 Trigger Financial Reconciliation on Terminal States
  if (order.status === 'delivered' || order.status === 'cancelled') {
    await syncFinancials(order.branchId);
  }
  broadcastUpdate(order.branchId || existing?.branchId);
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
      select: { id: true, total: true, status: true, orderType: true, subtotal: true, deliveryFee: true, discount: true, tax: true, version: true },
      take: 500
    });

    for (const order of orders) {
      activeOrdersMap.set(String(order.id), {
        branchId: bid,
        status: order.status,
        orderType: order.orderType || 'takeaway',
        version: order.version || 1
      });
    }
    
    // Dynamic idempotent reconstruction from the authoritative map
    rebuildBranchMetrics(bid);

    // 💰 Force Financial Sync from DB
    await syncFinancials(bid);
  }
}

function reset() {
  branchMap.clear();
  activeOrdersMap.clear();
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
  getMetrics: (branchId) => {
    const data = branchId ? getBranchMetrics(branchId) : getGlobalMetrics();
    if (!data) return null;
    return { ...data, sequence: data.eventSequence };
  },
};
