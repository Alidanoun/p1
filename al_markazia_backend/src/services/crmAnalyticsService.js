const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

/**
 * 📊 CRM Analytics Service
 * Aggregated metrics for the CRM dashboard.
 * All queries are branch-scoped via RLS.
 */
class CrmAnalyticsService {
  /**
   * Pipeline summary: count and value by stage + conversion rate
   */
  async getPipelineSummary(branchId, { startDate, endDate } = {}) {
    const dateFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);
    const createdAt = Object.keys(dateFilter).length ? dateFilter : undefined;

    const [stageGroups, totalLeads, convertedLeads, wonOpportunities] = await Promise.all([
      // Opportunities by stage with value sum
      prisma.opportunity.groupBy({
        by: ['stage'],
        where: { branchId, ...(createdAt && { createdAt }) },
        _count: { id: true },
        _sum: { value: true }
      }),
      // Total leads
      prisma.lead.count({ where: { branchId, ...(createdAt && { createdAt }) } }),
      // Converted leads
      prisma.lead.count({ where: { branchId, status: 'CONVERTED', ...(createdAt && { createdAt }) } }),
      // WON opportunities
      prisma.opportunity.count({ where: { branchId, stage: 'WON', ...(createdAt && { createdAt }) } })
    ]);

    const byStage = {};
    let totalPipelineValue = 0;
    let totalOpportunities = 0;

    for (const group of stageGroups) {
      const count = group._count.id;
      const value = parseFloat(group._sum.value || 0);
      byStage[group.stage] = { count, value };
      totalOpportunities += count;
      totalPipelineValue += value;
    }

    const conversionRate = totalLeads > 0
      ? ((convertedLeads / totalLeads) * 100).toFixed(1) + '%'
      : '0%';

    const winRate = totalOpportunities > 0
      ? ((wonOpportunities / totalOpportunities) * 100).toFixed(1) + '%'
      : '0%';

    return {
      totalLeads,
      convertedLeads,
      conversionRate,
      totalOpportunities,
      wonOpportunities,
      winRate,
      totalPipelineValue: totalPipelineValue.toFixed(2),
      byStage
    };
  }

  /**
   * Sales rep performance: leads assigned, converted, opportunities won
   */
  async getSalesPerformance(branchId, { startDate, endDate } = {}) {
    const createdFilter = {};
    if (startDate) createdFilter.gte = new Date(startDate);
    if (endDate) createdFilter.lte = new Date(endDate);
    const createdAt = Object.keys(createdFilter).length ? createdFilter : undefined;

    const [leadsByRep, opportunitiesByRep] = await Promise.all([
      prisma.lead.groupBy({
        by: ['assignedToId'],
        where: { branchId, assignedToId: { not: null }, ...(createdAt && { createdAt }) },
        _count: { id: true }
      }),
      prisma.opportunity.groupBy({
        by: ['assignedToId', 'stage'],
        where: { branchId, assignedToId: { not: null }, ...(createdAt && { createdAt }) },
        _count: { id: true },
        _sum: { value: true }
      })
    ]);

    // Fetch user info for all rep IDs
    const repIds = [...new Set([
      ...leadsByRep.map(r => r.assignedToId),
      ...opportunitiesByRep.map(r => r.assignedToId)
    ].filter(Boolean))];

    const users = await prisma.user.findMany({
      where: { id: { in: repIds } },
      select: { id: true, uuid: true, role: true }
    });
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    const repMap = {};
    for (const l of leadsByRep) {
      const uid = l.assignedToId;
      if (!repMap[uid]) repMap[uid] = { user: userMap[uid], leadsAssigned: 0, wonValue: 0, wonCount: 0, lostCount: 0 };
      repMap[uid].leadsAssigned = l._count.id;
    }
    for (const o of opportunitiesByRep) {
      const uid = o.assignedToId;
      if (!repMap[uid]) repMap[uid] = { user: userMap[uid], leadsAssigned: 0, wonValue: 0, wonCount: 0, lostCount: 0 };
      if (o.stage === 'WON') {
        repMap[uid].wonCount += o._count.id;
        repMap[uid].wonValue += parseFloat(o._sum.value || 0);
      }
      if (o.stage === 'LOST') repMap[uid].lostCount += o._count.id;
    }

    return Object.values(repMap).sort((a, b) => b.wonValue - a.wonValue);
  }

  /**
   * Lead sources breakdown with conversion rates
   */
  async getLeadSources(branchId, { startDate, endDate } = {}) {
    const createdFilter = {};
    if (startDate) createdFilter.gte = new Date(startDate);
    if (endDate) createdFilter.lte = new Date(endDate);
    const createdAt = Object.keys(createdFilter).length ? createdFilter : undefined;

    const groups = await prisma.lead.groupBy({
      by: ['source', 'status'],
      where: { branchId, ...(createdAt && { createdAt }) },
      _count: { id: true }
    });

    const sourceMap = {};
    for (const g of groups) {
      if (!sourceMap[g.source]) sourceMap[g.source] = { source: g.source, total: 0, converted: 0 };
      sourceMap[g.source].total += g._count.id;
      if (g.status === 'CONVERTED') sourceMap[g.source].converted += g._count.id;
    }

    return Object.values(sourceMap).map(s => ({
      ...s,
      conversionRate: s.total > 0 ? ((s.converted / s.total) * 100).toFixed(1) + '%' : '0%'
    })).sort((a, b) => b.total - a.total);
  }

  /**
   * Activity summary: count by type for a branch
   */
  async getActivitySummary(branchId, { startDate, endDate } = {}) {
    const createdFilter = {};
    if (startDate) createdFilter.gte = new Date(startDate);
    if (endDate) createdFilter.lte = new Date(endDate);
    const activityDate = Object.keys(createdFilter).length ? createdFilter : undefined;

    const groups = await prisma.salesActivity.groupBy({
      by: ['type'],
      where: { branchId, ...(activityDate && { activityDate }) },
      _count: { id: true }
    });

    return groups.map(g => ({ type: g.type, count: g._count.id }));
  }
}

module.exports = new CrmAnalyticsService();
