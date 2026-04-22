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
    if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
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
