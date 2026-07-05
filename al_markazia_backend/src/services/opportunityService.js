const prisma = require('../lib/prisma');
const { publishEvent } = require('../events/eventPublisher');
const logger = require('../utils/logger');
const { ConcurrencyError } = require('../utils/concurrencyError');

// Valid pipeline stages (must match schema)
const VALID_STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];
const TERMINAL_STAGES = ['WON', 'LOST'];

// Allowed stage transitions (State Machine)
const STAGE_TRANSITIONS = {
  NEW:         ['CONTACTED', 'LOST'],
  CONTACTED:   ['QUALIFIED', 'LOST'],
  QUALIFIED:   ['PROPOSAL', 'LOST'],
  PROPOSAL:    ['NEGOTIATION', 'WON', 'LOST'],
  NEGOTIATION: ['WON', 'LOST'],
  WON:         [],
  LOST:        []
};

/**
 * 💼 Opportunity Service
 * Manages the sales pipeline for potential deals.
 *
 * Key design decisions:
 * - Stage transitions enforced by a State Machine (STAGE_TRANSITIONS)
 * - All mutations use optimistic locking (version check in WHERE clause)
 * - Every stage change is recorded in OpportunityAuditLog for full history
 * - WON/LOST transitions are terminal — cannot be reversed
 *
 * Schema field mapping (verified against schema.prisma):
 *   estimatedValue → value  (Decimal field in schema)
 *   expectedCloseDate → expectedCloseDate  ✅
 *   closedAt → NOT in schema — tracked via updatedAt + terminal stage
 */
class OpportunityService {
  /**
   * Validate that assignedToId belongs to the same branch and is active
   */
  async _validateAssignee(tx, assignedToId, branchId) {
    if (!assignedToId) return;
    const user = await tx.user.findFirst({
      where: { id: assignedToId, branchId, isActive: true }
    });
    if (!user) {
      throw Object.assign(new Error('INVALID_ASSIGNMENT'), {
        statusCode: 400,
        message: 'المستخدم المحدد غير موجود في هذا الفرع أو غير نشط.'
      });
    }
  }

  /**
   * Create a new Opportunity linked to a Lead (optional) or Customer
   */
  async createOpportunity({ title, leadId, customerId, branchId, assignedToId, value, expectedCloseDate }, actor) {
    return await prisma.$transaction(async (tx) => {
      // Validate assignee belongs to branch
      await this._validateAssignee(tx, assignedToId, branchId);

      const opportunity = await tx.opportunity.create({
        data: {
          title,
          leadId: leadId || null,
          customerId: customerId || null,
          branchId,
          assignedToId: assignedToId || null,
          value: value ? String(value) : '0',             // Schema field: value (Decimal)
          expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
          stage: 'NEW',
          version: 1
        }
      });

      // Audit log entry for creation — using actual Schema fields
      await tx.opportunityAuditLog.create({
        data: {
          opportunityId: opportunity.id,
          eventType: 'OPPORTUNITY_CREATED',
          eventAction: 'CREATED',
          changedById: actor?.id || null,
          changedByRole: actor?.role || 'system',
          previousData: null,
          newData: JSON.stringify({ stage: 'NEW', title }),
          reason: null
        }
      });

      await publishEvent({
        type: 'OPPORTUNITY_CREATED',
        aggregateId: opportunity.id,
        payload: { opportunityId: opportunity.id, branchId, stage: 'NEW' },
        metadata: { tx, aggregateType: 'Opportunity', actorId: actor?.id }
      });

      logger.info('[OpportunityService] Opportunity created', { opportunityId: opportunity.id, branchId });
      return opportunity;
    });
  }

  /**
   * Change the stage of an Opportunity.
   * Uses optimistic locking (WHERE version = currentVersion) to prevent Lost Updates.
   */
  async changeStage(opportunityId, targetStage, actor, clientVersion, lossReason = null) {
    if (!VALID_STAGES.includes(targetStage)) {
      throw Object.assign(new Error('INVALID_STAGE'), { statusCode: 400, message: `المرحلة '${targetStage}' غير صحيحة.` });
    }

    const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
    if (!opportunity) throw Object.assign(new Error('OPPORTUNITY_NOT_FOUND'), { statusCode: 404 });
    if (TERMINAL_STAGES.includes(opportunity.stage)) {
      throw Object.assign(new Error('STAGE_TERMINAL'), { statusCode: 409, message: 'لا يمكن تغيير مرحلة صفقة مغلقة.' });
    }

    // State Machine Validation
    const allowed = STAGE_TRANSITIONS[opportunity.stage] || [];
    if (!allowed.includes(targetStage)) {
      throw Object.assign(new Error('INVALID_STAGE_TRANSITION'), {
        statusCode: 409,
        message: `الانتقال من '${opportunity.stage}' إلى '${targetStage}' غير مسموح.`
      });
    }

    const versionToCheck = clientVersion !== undefined ? parseInt(clientVersion) : opportunity.version;

    return await prisma.$transaction(async (tx) => {
      const updateData = {
        stage: targetStage,
        version: { increment: 1 },
        // Store lossReason on LOST transitions (Schema field: lossReason)
        ...(targetStage === 'LOST' && lossReason ? { lossReason } : {})
      };

      const result = await tx.opportunity.updateMany({
        where: { id: opportunityId, version: versionToCheck },
        data: updateData
      });

      if (result.count === 0) {
        throw new ConcurrencyError('OPPORTUNITY_CONFLICT', 'تعذر تحديث المرحلة: حالة الصفقة تغيرت. يرجى تحديث الصفحة.');
      }

      // Write immutable audit trail using actual Schema fields
      await tx.opportunityAuditLog.create({
        data: {
          opportunityId,
          eventType: 'STAGE_CHANGE',
          eventAction: `MOVED_TO_${targetStage}`,
          changedById: actor?.id || null,
          changedByRole: actor?.role || 'system',
          previousData: JSON.stringify({ stage: opportunity.stage }),
          newData: JSON.stringify({ stage: targetStage }),
          reason: targetStage === 'LOST' ? (lossReason || 'No reason provided') : null
        }
      });

      const eventType = targetStage === 'WON'  ? 'OPPORTUNITY_WON'
                      : targetStage === 'LOST' ? 'OPPORTUNITY_LOST'
                      : 'OPPORTUNITY_STAGE_CHANGED';

      await publishEvent({
        type: eventType,
        aggregateId: opportunityId,
        payload: {
          opportunityId,
          fromStage: opportunity.stage,
          toStage: targetStage,
          branchId: opportunity.branchId,
          value: opportunity.value,
          lossReason: targetStage === 'LOST' ? lossReason : null
        },
        metadata: { tx, aggregateType: 'Opportunity', actorId: actor?.id }
      });

      logger.info('[OpportunityService] Stage changed', { opportunityId, from: opportunity.stage, to: targetStage });
      return { success: true, opportunityId, fromStage: opportunity.stage, toStage: targetStage };
    });
  }

  /**
   * Reassign opportunity to a different user
   */
  async reassign(opportunityId, newAssignedToId, actor) {
    const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
    if (!opportunity) throw Object.assign(new Error('OPPORTUNITY_NOT_FOUND'), { statusCode: 404 });

    return await prisma.$transaction(async (tx) => {
      await this._validateAssignee(tx, newAssignedToId, opportunity.branchId);

      await tx.opportunity.update({
        where: { id: opportunityId },
        data: { assignedToId: newAssignedToId, version: { increment: 1 } }
      });

      await tx.opportunityAuditLog.create({
        data: {
          opportunityId,
          eventType: 'ASSIGNMENT_CHANGE',
          eventAction: 'REASSIGNED',
          changedById: actor?.id || null,
          changedByRole: actor?.role || 'system',
          previousData: JSON.stringify({ assignedToId: opportunity.assignedToId }),
          newData: JSON.stringify({ assignedToId: newAssignedToId }),
          reason: null
        }
      });

      await publishEvent({
        type: 'OPPORTUNITY_REASSIGNED',
        aggregateId: opportunityId,
        payload: { opportunityId, fromUserId: opportunity.assignedToId, toUserId: newAssignedToId },
        metadata: { tx, aggregateType: 'Opportunity', actorId: actor?.id }
      });

      return { success: true, opportunityId, assignedToId: newAssignedToId };
    });
  }

  /**
   * Get paginated pipeline for a branch with cursor-based pagination
   * (offset pagination is replaced for scale)
   */
  async getPipeline(branchId, { stage, assignedToId, cursor, page = 1, limit = 20 } = {}) {
    const where = { branchId };
    if (stage) where.stage = stage;
    if (assignedToId) where.assignedToId = parseInt(assignedToId);

    // Cursor-based pagination for large datasets
    if (cursor) {
      const [opportunities, total] = await Promise.all([
        prisma.opportunity.findMany({
          where,
          take: parseInt(limit) + 1,
          cursor: { id: parseInt(cursor) },
          skip: 1,
          orderBy: { id: 'asc' }
        }),
        prisma.opportunity.count({ where })
      ]);
      const hasNextPage = opportunities.length > limit;
      const items = hasNextPage ? opportunities.slice(0, -1) : opportunities;
      return { opportunities: items, total, nextCursor: hasNextPage ? items[items.length - 1].id : null };
    }

    // Offset pagination for small datasets / first page
    const [opportunities, total] = await Promise.all([
      prisma.opportunity.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      }),
      prisma.opportunity.count({ where })
    ]);
    return { opportunities, total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) };
  }

  /**
   * Get full stage history for a single opportunity
   */
  async getHistory(opportunityId) {
    return prisma.opportunityAuditLog.findMany({
      where: { opportunityId },
      orderBy: { createdAt: 'asc' },
      include: { changedBy: { select: { id: true, uuid: true, role: true } } }
    });
  }

  /**
   * Search opportunities by title
   */
  async searchOpportunities(branchId, query, { stage, page = 1, limit = 20 } = {}) {
    const where = {
      branchId,
      ...(query && { title: { contains: query, mode: 'insensitive' } }),
      ...(stage && { stage })
    };
    const [opportunities, total] = await Promise.all([
      prisma.opportunity.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.opportunity.count({ where })
    ]);
    return { opportunities, total, page, limit, pages: Math.ceil(total / limit) };
  }
}

module.exports = new OpportunityService();
