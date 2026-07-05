const prisma = require('../lib/prisma');
const { publishEvent } = require('../events/eventPublisher');
const logger = require('../utils/logger');

const VALID_ACTIVITY_TYPES = ['CALL', 'EMAIL', 'WHATSAPP', 'MEETING', 'NOTE'];

/**
 * 📋 SalesActivity Service
 * Logs human interactions with leads, customers, and opportunities.
 * Every activity is linked to at least one entity (lead, customer, or opportunity).
 *
 * Core features:
 * - Activity timeline per lead, customer, or opportunity
 * - Customer 360° view (all activities + orders + loyalty)
 * - Branch-scoped via RLS (branchId always set from BranchAccessMiddleware)
 */
class SalesActivityService {
  /**
   * Log a new sales activity (call, meeting, note, etc.)
   */
  async logActivity({ type, subject, notes, leadId, customerId, opportunityId, branchId, scheduledAt }, actor) {
    if (!VALID_ACTIVITY_TYPES.includes(type)) {
      throw Object.assign(new Error('INVALID_ACTIVITY_TYPE'), {
        statusCode: 400,
        message: `نوع النشاط '${type}' غير صحيح. الأنواع المدعومة: ${VALID_ACTIVITY_TYPES.join(', ')}`
      });
    }
    if (!leadId && !customerId && !opportunityId) {
      throw Object.assign(new Error('ENTITY_REQUIRED'), {
        statusCode: 400,
        message: 'يجب ربط النشاط بعميل محتمل أو عميل مسجل أو صفقة على الأقل.'
      });
    }

    return await prisma.$transaction(async (tx) => {
      const activity = await tx.salesActivity.create({
        data: {
          type,
          subject: subject || null,
          notes: notes || null,
          leadId: leadId ? parseInt(leadId) : null,
          customerId: customerId ? parseInt(customerId) : null,
          opportunityId: opportunityId ? parseInt(opportunityId) : null,
          branchId,
          performedById: actor.id,
          activityDate: scheduledAt ? new Date(scheduledAt) : new Date()
        },
        include: {
          performedBy: { select: { id: true, uuid: true, role: true } }
        }
      });

      // If linked to an opportunity, bump its updatedAt to reflect activity
      if (opportunityId) {
        await tx.opportunity.update({
          where: { id: parseInt(opportunityId) },
          data: { updatedAt: new Date() }
        });
      }

      await publishEvent({
        type: 'SALES_ACTIVITY_LOGGED',
        aggregateId: activity.id,
        payload: { activityId: activity.id, type, leadId, customerId, opportunityId, branchId },
        metadata: { tx, aggregateType: 'SalesActivity', actorId: actor?.id },
        isCritical: false // Non-critical: real-time notification only
      });

      logger.info('[SalesActivityService] Activity logged', { activityId: activity.id, type, branchId });
      return activity;
    });
  }

  /**
   * Get activities with filters — paginated
   */
  async getActivities(branchId, { leadId, customerId, opportunityId, type, page = 1, limit = 20 } = {}) {
    const where = { branchId };
    if (leadId) where.leadId = parseInt(leadId);
    if (customerId) where.customerId = parseInt(customerId);
    if (opportunityId) where.opportunityId = parseInt(opportunityId);
    if (type) where.type = type;

    const [activities, total] = await Promise.all([
      prisma.salesActivity.findMany({
        where,
        orderBy: { activityDate: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        include: {
          performedBy: { select: { id: true, uuid: true, role: true } }
        }
      }),
      prisma.salesActivity.count({ where })
    ]);

    return { activities, total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) };
  }

  /**
   * Get full activity timeline for a Lead
   */
  async getLeadTimeline(leadId, branchId) {
    const lead = await prisma.lead.findFirst({
      where: { id: parseInt(leadId), branchId }
    });
    if (!lead) throw Object.assign(new Error('LEAD_NOT_FOUND'), { statusCode: 404 });

    const [activities, opportunities] = await Promise.all([
      prisma.salesActivity.findMany({
        where: { leadId: parseInt(leadId) },
        orderBy: { activityDate: 'desc' },
        include: { performedBy: { select: { id: true, uuid: true, role: true } } }
      }),
      prisma.opportunity.findMany({
        where: { leadId: parseInt(leadId) },
        select: { id: true, title: true, stage: true, value: true, createdAt: true, updatedAt: true }
      })
    ]);

    return { lead: { id: lead.id, name: lead.name, status: lead.status }, activities, opportunities };
  }

  /**
   * Customer 360° View
   * Full profile: orders, loyalty, CRM activities, lead history, opportunities
   */
  async getCustomer360(customerId, branchId) {
    const [customer, activities, opportunities, recentOrders] = await Promise.all([
      prisma.customer.findUnique({
        where: { id: parseInt(customerId) },
        select: {
          id: true, name: true, phone: true, email: true,
          points: true, walletBalance: true, tier: true,
          totalOrders: true, riskScore: true,
          createdAt: true, isBlacklisted: true
        }
      }),
      prisma.salesActivity.findMany({
        where: { customerId: parseInt(customerId), branchId },
        orderBy: { activityDate: 'desc' },
        take: 20,
        include: { performedBy: { select: { id: true, uuid: true, role: true } } }
      }),
      prisma.opportunity.findMany({
        where: { customerId: parseInt(customerId) },
        select: { id: true, title: true, stage: true, value: true, createdAt: true }
      }),
      prisma.order.findMany({
        where: { customerId: parseInt(customerId), branchId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, orderNumber: true, status: true, total: true, createdAt: true }
      })
    ]);

    if (!customer) throw Object.assign(new Error('CUSTOMER_NOT_FOUND'), { statusCode: 404 });

    return { customer, activities, opportunities, recentOrders };
  }
}

module.exports = new SalesActivityService();
