const { DateTime } = require('luxon');
const { toNumber, toMoney } = require('../utils/number');
const accountingService = require('../services/accountingService');
const redis = require('../lib/redis');
const logger = require('../utils/logger');

// Local in-memory fallbacks/cache for maximum performance, synchronous unit tests, and fault resilience
const branchMap = new Map();
const activeOrdersMap = new Map();
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
    if (activeBranchIds.size > 0 && !activeBranchIds.has(branchId)) continue;

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
  global.version = Math.max(...Array.from(branchMap.values()).map(m => m.version || 1), 1);
  global.eventSequence = Math.max(...Array.from(branchMap.values()).map(m => m.eventSequence || 0), 0);
  return global;
}

// 🛡️ Redis Resilient Helper for loading metrics from the cluster cache
async function loadMetricsFromRedis(branchId) {
  const key = branchId || 'SYSTEM_DEFAULT';
  const redisKey = `analytics:metrics:${key}`;
  const raw = await redis.hgetall(redisKey);
  
  if (!raw || Object.keys(raw).length === 0) {
    return getBranchMetrics(branchId);
  }
  
  const defaults = getInitialMetrics();
  const metrics = {
    financials: { ...defaults.financials, ...JSON.parse(raw.financials || '{}') },
    counts: { ...defaults.counts, ...JSON.parse(raw.counts || '{}') },
    statusDistribution: { ...defaults.statusDistribution, ...JSON.parse(raw.statusDistribution || '{}') },
    typeDistribution: { ...defaults.typeDistribution, ...JSON.parse(raw.typeDistribution || '{}') },
    activityFeed: JSON.parse(raw.activityFeed || '[]'),
    updatedAt: new Date(raw.updatedAt || Date.now()),
    version: parseInt(raw.version || '1'),
    eventSequence: parseInt(raw.eventSequence || '0')
  };
  
  branchMap.set(key, metrics);
  return metrics;
}

// 🛡️ Redis Resilient Helper for saving metrics to the cluster cache
async function saveMetricsToRedis(branchId, metrics) {
  const key = branchId || 'SYSTEM_DEFAULT';
  const redisKey = `analytics:metrics:${key}`;
  
  metrics.updatedAt = new Date();
  metrics.version = (metrics.version || 0) + 1;
  metrics.eventSequence += 1;
  
  await redis.hset(redisKey, {
    financials: JSON.stringify(metrics.financials),
    counts: JSON.stringify(metrics.counts),
    statusDistribution: JSON.stringify(metrics.statusDistribution),
    typeDistribution: JSON.stringify(metrics.typeDistribution),
    activityFeed: JSON.stringify(metrics.activityFeed),
    updatedAt: metrics.updatedAt.toISOString(),
    version: metrics.version.toString(),
    eventSequence: metrics.eventSequence.toString()
  });
  
  if (redis.publisher && typeof redis.publisher.publish === 'function') {
    await redis.publisher.publish('analytics:reload', JSON.stringify({ branchId: key }));
  }
}

// Synchronous Memory Metrics Rebuilder to guarantee immediate updates & test compatibility
function rebuildBranchMetricsSync(branchId) {
  const metrics = getBranchMetrics(branchId);
  metrics.counts.total = 0;
  metrics.counts.active = 0;
  Object.keys(metrics.statusDistribution).forEach(k => metrics.statusDistribution[k] = 0);
  Object.keys(metrics.typeDistribution).forEach(k => metrics.typeDistribution[k] = 0);

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

// Synchronous Memory Activity Log updates
function pushActivityLogSync(branchId, order, action) {
  const metrics = getBranchMetrics(branchId);
  if (!metrics.activityFeed) metrics.activityFeed = [];
  metrics.activityFeed.unshift({
    id: `${order.id}-${Date.now()}`,
    orderNumber: order.orderNumber,
    action,
    status: order.status,
    time: new Date()
  });
  if (metrics.activityFeed.length > 40) metrics.activityFeed.pop();

  metrics.updatedAt = new Date();
  metrics.version = (metrics.version || 0) + 1;
  metrics.eventSequence += 1;
}

// Background asynchronous cluster sync
async function syncWithRedisAsync(branchId, orderId, snap, order) {
  try {
    await redis.hset(`analytics:active_orders:${branchId}`, orderId, JSON.stringify(snap));
    await redis.set(`analytics:order_version:${orderId}`, (snap.version || 1).toString(), 'EX', 86400);

    const metrics = await loadMetricsFromRedis(branchId);
    const rawOrders = await redis.hgetall(`analytics:active_orders:${branchId}`);

    metrics.counts.total = 0;
    metrics.counts.active = 0;
    Object.keys(metrics.statusDistribution).forEach(k => metrics.statusDistribution[k] = 0);
    Object.keys(metrics.typeDistribution).forEach(k => metrics.typeDistribution[k] = 0);

    for (const rawStr of Object.values(rawOrders)) {
      const s = JSON.parse(rawStr);
      metrics.counts.total += 1;
      const st = s.status || 'pending';
      metrics.statusDistribution[st] = (metrics.statusDistribution[st] || 0) + 1;
      const ty = s.orderType || 'takeaway';
      metrics.typeDistribution[ty] = (metrics.typeDistribution[ty] || 0) + 1;

      if (st !== 'delivered' && st !== 'cancelled') {
        metrics.counts.active += 1;
      }
    }

    if (order.status !== 'delivered' && order.status !== 'cancelled') {
      await saveMetricsToRedis(branchId, metrics);
    }
  } catch (err) {
    logger.warn('[Analytics] Redis cluster background sync failed', { error: err.message });
  }
}

function handleCreated(payload) {
  const order = payload?.order || payload;
  if (!order || !order.id) return;

  const orderId = String(order.id);
  const incomingVersion = order.version || 1;
  const existing = activeOrdersMap.get(orderId);

  if (existing && existing.version >= incomingVersion) {
    return;
  }

  const snap = {
    branchId: order.branchId,
    status: order.status || 'pending',
    orderType: order.orderType || 'takeaway',
    version: incomingVersion,
    processedAt: Date.now()
  };

  activeOrdersMap.set(orderId, snap);
  rebuildBranchMetricsSync(order.branchId);
  pushActivityLogSync(order.branchId, order, 'تم إنشاء طلب جديد');
  broadcastUpdate(order.branchId);

  syncWithRedisAsync(order.branchId, orderId, snap, order).catch(err => {
    logger.warn('[Analytics] syncWithRedisAsync handleCreated failed', { error: err.message });
  });
}

function handleModified(payload) {
  const order = payload?.order || payload;
  if (!order || !order.id) return;

  const orderId = String(order.id);
  const incomingVersion = order.version || 0;
  const existing = activeOrdersMap.get(orderId);

  if (existing && incomingVersion && existing.version >= incomingVersion) {
    return;
  }

  const snap = {
    branchId: order.branchId || existing?.branchId,
    status: order.status || existing?.status || 'pending',
    orderType: order.orderType || existing?.orderType || 'takeaway',
    version: incomingVersion || existing?.version || 1,
    processedAt: Date.now()
  };

  activeOrdersMap.set(orderId, snap);
  rebuildBranchMetricsSync(snap.branchId);
  pushActivityLogSync(snap.branchId, order, 'تعديل على الطلب');

  if (order.status === 'delivered' || order.status === 'cancelled') {
    syncFinancials(snap.branchId).catch(err => {
      logger.warn('[Analytics] syncFinancials handleModified failed', { error: err.message });
    });
  }
  broadcastUpdate(snap.branchId);

  syncWithRedisAsync(snap.branchId, orderId, snap, order).catch(err => {
    logger.warn('[Analytics] syncWithRedisAsync handleModified failed', { error: err.message });
  });
}

function handleStatusChange(payload) {
  const order = payload?.order || payload;
  if (!order || !order.id) return;

  const orderId = String(order.id);
  const incomingVersion = order.version || 0;
  const existing = activeOrdersMap.get(orderId);

  if (existing && incomingVersion && existing.version >= incomingVersion) {
    return;
  }

  const snap = {
    branchId: order.branchId || existing?.branchId,
    status: order.status,
    orderType: order.orderType || existing?.orderType || 'takeaway',
    version: incomingVersion,
    processedAt: Date.now()
  };

  activeOrdersMap.set(orderId, snap);
  rebuildBranchMetricsSync(snap.branchId);

  const statusAr = { confirmed: 'تأكيد الطلب', preparing: 'تجهيز الطلب', ready: 'الطلب جاهز', in_route: 'خرج للتوصيل', delivered: 'تم التسليم', cancelled: 'إلغاء الطلب' }[order.status] || order.status;
  pushActivityLogSync(snap.branchId, order, `تحديث الحالة: ${statusAr}`);

  if (order.status === 'delivered' || order.status === 'cancelled') {
    syncFinancials(snap.branchId).catch(err => {
      logger.warn('[Analytics] syncFinancials handleStatusChange failed', { error: err.message });
    });
  }
  broadcastUpdate(snap.branchId);

  syncWithRedisAsync(snap.branchId, orderId, snap, order).catch(err => {
    logger.warn('[Analytics] syncWithRedisAsync handleStatusChange failed', { error: err.message });
  });
}

async function syncFinancials(branchId) {
  const prisma = require('../lib/prisma');
  const ammanNow = DateTime.now().setZone('Asia/Amman');
  const ammanStartOfDay = ammanNow.startOf('day').toJSDate();

  let metrics = getBranchMetrics(branchId);
  try {
    metrics = await loadMetricsFromRedis(branchId);
  } catch (err) { /* Offline Fallback */ }

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
    
    if (metrics.counts.delivered % 50 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
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

  try {
    await saveMetricsToRedis(branchId, metrics);
  } catch (err) { /* Offline Fallback */ }
}

async function replay(targetBranchId = null) {
  const prisma = require('../lib/prisma');
  const ammanNow = DateTime.now().setZone('Asia/Amman');
  const ammanStartOfDay = ammanNow.startOf('day').toJSDate();

  if (!targetBranchId) {
    const activeBranches = await prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true }
    });
    activeBranchIds = new Set(activeBranches.map(b => b.id));
    await reset();
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

    try {
      await redis.del(`analytics:active_orders:${bid}`);
    } catch (err) { /* Offline Fallback */ }

    for (const order of orders) {
      const snap = {
        branchId: bid,
        status: order.status,
        orderType: order.orderType || 'takeaway',
        version: order.version || 1,
        processedAt: Date.now()
      };
      activeOrdersMap.set(String(order.id), snap);

      try {
        await redis.hset(`analytics:active_orders:${bid}`, String(order.id), JSON.stringify(snap));
        await redis.set(`analytics:order_version:${order.id}`, (order.version || 1).toString(), 'EX', 86400);
      } catch (err) { /* Offline Fallback */ }
    }
    
    rebuildBranchMetricsSync(bid);
    await syncFinancials(bid);
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function reset() {
  branchMap.clear();
  activeOrdersMap.clear();
  try {
    const keys = await redis.keys('analytics:*');
    if (keys.length > 0) {
      await redis.del(keys);
    }
  } catch (err) { /* Offline Fallback */ }
}

async function periodicCleanup() {
  const maxAge = 24 * 60 * 60 * 1000;
  const now = Date.now();
  
  const branches = Array.from(activeBranchIds);
  for (const bid of branches) {
    const redisKeyActive = `analytics:active_orders:${bid}`;
    try {
      const rawOrders = await redis.hgetall(redisKeyActive);
      for (const [orderId, recordStr] of Object.entries(rawOrders)) {
        const record = JSON.parse(recordStr);
        if (now - (record.processedAt || 0) > maxAge) {
          await redis.hdel(redisKeyActive, orderId);
        }
      }
    } catch (err) { /* Offline Fallback */ }
  }

  for (const [orderId, record] of activeOrdersMap.entries()) {
    if (now - (record.processedAt || 0) > maxAge) {
      activeOrdersMap.delete(orderId);
    }
  }
}

function getMetrics(branchId) {
  const key = branchId || 'SYSTEM_DEFAULT';
  if (key === 'SYSTEM_DEFAULT') {
    return getGlobalMetrics();
  }
  
  if (!branchMap.has(key)) {
    branchMap.set(key, getInitialMetrics());
  }
  
  const data = branchMap.get(key);
  return { ...data, sequence: data.eventSequence };
}

function broadcastUpdate(branchId) {
  try {
    const socketModule = require('../socket');
    if (socketModule.isReady && socketModule.isReady()) {
      const io = socketModule.getIO();
      const { SOCKET_ROOMS, SOCKET_EVENTS } = require('../shared/socketEvents');
      io.broadcastSmart(SOCKET_ROOMS.MONITOR_BRANCH(branchId), SOCKET_EVENTS.DASHBOARD_METRICS_UPDATE, getMetrics(branchId));
      io.broadcastSmart(SOCKET_ROOMS.MONITOR_GLOBAL, SOCKET_EVENTS.DASHBOARD_METRICS_UPDATE, getMetrics(null));
    }
  } catch (err) { /* Offline Fallback */ }
}

// Setup pub/sub subscriber safely
try {
  if (redis.subscriber && typeof redis.subscriber.subscribe === 'function') {
    redis.subscriber.subscribe('analytics:reload').catch(err => {
      logger.error('[Analytics] Failed to subscribe to analytics:reload', { error: err.message });
    });

    redis.subscriber.on('message', (channel, message) => {
      if (channel === 'analytics:reload') {
        try {
          const { branchId } = JSON.parse(message);
          loadMetricsFromRedis(branchId).catch(err => {
            logger.error('[Analytics] Failed to reload metrics from Redis on trigger', { branchId, error: err.message });
          });
        } catch (err) {
          logger.error('[Analytics] Error parsing reload message', { error: err.message });
        }
      }
    });
  }
} catch (err) {
  logger.warn('[Analytics] Redis Pub/Sub subscription skipped (offline/mocked)', { error: err.message });
}

module.exports = {
  handleCreated,
  handleModified,
  handleStatusChange,
  reset,
  replay,
  syncFinancials,
  periodicCleanup,
  getMetrics
};
