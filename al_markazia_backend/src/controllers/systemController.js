const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

/**
 * Enterprise System Controller
 * Handles administrative maintenance and migration auditing tasks.
 */

/**
 * 🔍 Identity Auditor (Final Consolidation Version)
 * Scans the database for UUID consistency and legacy data mapping.
 */
exports.checkIdentityConsistency = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const results = {
      timestamp: new Date().toISOString(),
      migrationProgress: 0,
      summary: {},
      anomalies: []
    };

    // 1. Audit Customers
    const totalCustomers = await prisma.customer.count();
    const missingUuid = await prisma.customer.count({ where: { uuid: null } });
    const missingFcm = await prisma.customer.count({ where: { fcmToken: null } });

    results.summary.customers = {
      total: totalCustomers,
      uuidSynchronized: totalCustomers - missingUuid,
      fcmTokenMapped: totalCustomers - missingFcm
    };

    // 2. Audit Traceability (IDOR Prevention Check)
    const orphans = await prisma.order.count({ where: { customerId: null } });
    results.summary.orders = {
      total: await prisma.order.count(),
      linkedToIdentity: (await prisma.order.count()) - orphans,
      unlinkedLegacyOrders: orphans
    };

    // 3. 🔍 Deep Anomaly Detection
    if (missingUuid > 0) {
      results.anomalies.push({
        severity: 'HIGH',
        type: 'MISSING_UUID',
        count: missingUuid,
        message: 'Records found without UUID. These will be invisible to the new API.'
      });
    }

    if (orphans > 0) {
      results.anomalies.push({
        severity: 'MEDIUM',
        type: 'ORPHAN_ORDERS',
        count: orphans,
        message: 'Orders not linked to a Customer ID. These rely on phone-lookup (Legacy).'
      });
    }

    // Calculate progression percentage
    const totalChecks = totalCustomers + (results.summary.orders.total || 0);
    const passedChecks = (totalCustomers - missingUuid) + (results.summary.orders.total - orphans);
    results.migrationProgress = totalChecks > 0 ? (passedChecks / totalChecks) * 100 : 100;

    res.json({ success: true, data: results });

  } catch (error) {
    logger.error('Identity Audit Failed', { error: error.message });
    res.status(500).json({ error: 'Internal Audit Error' });
  }
};

/**
 * 📊 Real-Time System Diagnostics
 * Aggregates health metrics from Socket.IO and tiered Cache systems.
 */
exports.getSystemDiagnostics = async (req, res) => {
  try {
    const socketModule = require('../socket');
    const cacheService = require('../services/cacheService');

    const [socketStats, cacheStats] = await Promise.all([
      Promise.resolve(socketModule.getStats ? socketModule.getStats() : { error: 'Socket stats not available' }),
      cacheService.getStats()
    ]);

    res.json({
      success: true,
      data: {
        socket: socketStats,
        cache: cacheStats,
        server: {
          uptime: Math.floor(process.uptime()),
          memory: process.memoryUsage(),
          timestamp: new Date().toISOString()
        }
      }
    });
  } catch (err) {
    logger.error('Diagnostics Fetch Failed', { error: err.message });
    res.status(500).json({ error: 'Internal Diagnostics Error' });
  }
};
/**
 * 🛰️ Event Bus Health Monitor
 * Reports on Redis Pub/Sub connectivity and distributed sync status.
 */
exports.getEventHealth = async (req, res) => {
  try {
    const { publisher, subscriber } = require('../lib/redis');
    const os = require('os');

    const health = {
      instance: os.hostname(),
      timestamp: new Date().toISOString(),
      connections: {
        publisher: publisher.status,
        subscriber: subscriber.status
      },
      pubsub: {
        channelsSubscribed: subscriber.condition?.subscriber?.channels?.length || 0,
        db: subscriber.options.db
      },
      uptime: Math.floor(process.uptime())
    };

    const isHealthy = publisher.status === 'ready' && subscriber.status === 'ready';

    res.json({
      success: isHealthy,
      data: health
    });
  } catch (err) {
    logger.error('Event Health Check Failed', { error: err.message });
    res.status(500).json({ success: false, error: 'Internal Health Check Error' });
  }
};
