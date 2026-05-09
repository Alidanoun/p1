const prisma = require('../lib/prisma');
const response = require('../utils/response');
const { translateAction, getFriendlyCategory } = require('../utils/auditTranslator');

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

    const [rawLogs, total] = await Promise.all([
      prisma.systemAuditLog.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.systemAuditLog.count({ where })
    ]);

    // 🕵️ Enrichment: Map User IDs to real names/emails
    const uniqueUserUuids = [...new Set(rawLogs.map(l => l.userId).filter(Boolean))];
    const users = await prisma.user.findMany({
      where: { uuid: { in: uniqueUserUuids } },
      select: { uuid: true, name: true, email: true, role: true }
    });

    const userMap = users.reduce((acc, u) => ({ ...acc, [u.uuid]: u }), {});

    // 🌍 Transformation: Add human-friendly fields
    const logs = rawLogs.map(log => {
      const user = userMap[log.userId];
      return {
        ...log,
        friendlyAction: translateAction(log.action),
        friendlyCategory: getFriendlyCategory(log),
        userName: user ? user.name || user.email.split('@')[0] : (log.userEmail || 'System'),
        userDisplay: user ? `${user.name || 'Admin'} (${user.role})` : 'النظام الآلي'
      };
    });

    response.success(res, {
      logs,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('[AuditEnrichment] Error:', err);
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

    // Translate Top Actions for the dashboard too
    const translatedActions = recentActions.map(a => ({
      ...a,
      action: translateAction(a.action)
    }));

    response.success(res, {
      totalToday,
      errorsToday,
      criticalToday,
      topActions: translatedActions
    });
  } catch (err) {
    response.error(res, 'Failed to fetch audit stats', 'AUDIT_STATS_ERROR');
  }
};

module.exports = {
  getLogs,
  getStats
};
