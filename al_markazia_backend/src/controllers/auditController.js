const prisma = require('../lib/prisma');
const response = require('../utils/response');
const { translateAction, getFriendlyCategory } = require('../utils/auditTranslator');
const { decrypt, hashBlind } = require('../utils/crypto');

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

    // 🛡️ [PHASE 4] Zero-Trust Isolation for Audit Logs
    const SecurityPolicyService = require('../services/securityPolicyService');
    const isolationFilter = await SecurityPolicyService.getHardenedFilter(req.user, 'SystemAuditLog');

    const [rawLogs, total] = await Promise.all([
      prisma.systemAuditLog.findMany({
        where: { ...where, ...isolationFilter },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.systemAuditLog.count({ where: { ...where, ...isolationFilter } })
    ]);

    // 1. Extract unique users and resolve identities
    const enrichedLogs = rawLogs.map(log => {
      let resolvedEmail = log.userEmail;
      if (resolvedEmail && resolvedEmail.includes(':')) {
        resolvedEmail = decrypt(resolvedEmail);
      }
      return { ...log, resolvedEmail, emailHash: resolvedEmail ? hashBlind(resolvedEmail) : null };
    });

    const uniqueEmailHashes = [...new Set(enrichedLogs.map(l => l.emailHash).filter(Boolean))];
    const users = await prisma.user.findMany({
      where: { emailHash: { in: uniqueEmailHashes } },
      select: { emailHash: true, name: true, email: true, role: true }
    });

    const userMap = users.reduce((acc, u) => {
      acc[u.emailHash] = u;
      return acc;
    }, {});

    // 2. Transform into human-friendly format
    const logs = enrichedLogs.map(log => {
      const user = userMap[log.emailHash];
      const nameFromEmail = log.resolvedEmail ? log.resolvedEmail.split('@')[0] : 'System';
      
      return {
        ...log,
        friendlyAction: translateAction(log.action),
        friendlyCategory: getFriendlyCategory(log),
        userName: user ? user.name || nameFromEmail : (log.resolvedEmail || 'System'),
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
    logger.error('[AuditEnrichment] Error:', { error: err.message });
    response.error(res, 'Failed to fetch audit logs', 'AUDIT_FETCH_ERROR');
  }
};

const getStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 🛡️ [PHASE 4] Zero-Trust Isolation for Audit Stats
    const SecurityPolicyService = require('../services/securityPolicyService');
    const isolationFilter = await SecurityPolicyService.getHardenedFilter(req.user, 'SystemAuditLog');

    const [totalToday, errorsToday, criticalToday, recentActions] = await Promise.all([
      prisma.systemAuditLog.count({ 
        where: { ...isolationFilter, createdAt: { gte: today } } 
      }),
      prisma.systemAuditLog.count({ 
        where: { ...isolationFilter, status: 'FAIL', createdAt: { gte: today } } 
      }),
      prisma.systemAuditLog.count({ 
        where: { ...isolationFilter, severity: 'CRITICAL', createdAt: { gte: today } } 
      }),
      prisma.systemAuditLog.groupBy({
        by: ['action'],
        where: { ...isolationFilter, createdAt: { gte: today } },
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
