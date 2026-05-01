const prisma = require('../lib/prisma');
const response = require('../utils/response');

/**
 * 🧾 Audit Controller
 * Provides APIs for the Observability Dashboard.
 */

const getLogs = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      action, 
      userId, 
      status, 
      severity, 
      entityType,
      startDate,
      endDate 
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build Filter
    const where = {};
    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (entityType) where.entityType = entityType;
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      prisma.systemAuditLog.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.systemAuditLog.count({ where })
    ]);

    response.success(res, {
      logs,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    response.error(res, 'Failed to fetch audit logs', 'AUDIT_FETCH_ERROR');
  }
};

const getStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalToday, errorsToday, criticalToday, recentActions] = await Promise.all([
      prisma.systemAuditLog.count({ where: { createdAt: { gte: today } } }),
      prisma.systemAuditLog.count({ where: { status: 'FAIL', createdAt: { gte: today } } }),
      prisma.systemAuditLog.count({ where: { severity: 'CRITICAL', createdAt: { gte: today } } }),
      prisma.systemAuditLog.groupBy({
        by: ['action'],
        where: { createdAt: { gte: today } },
        _count: true,
        orderBy: { _count: { action: 'desc' } },
        take: 5
      })
    ]);

    response.success(res, {
      totalToday,
      errorsToday,
      criticalToday,
      topActions: recentActions
    });
  } catch (err) {
    response.error(res, 'Failed to fetch audit stats', 'AUDIT_STATS_ERROR');
  }
};

module.exports = {
  getLogs,
  getStats
};
