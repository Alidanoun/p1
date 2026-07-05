const prisma = require('../lib/prisma');
const { publishEvent } = require('../events/eventPublisher');
const logger = require('../utils/logger');
const { ConcurrencyError } = require('../utils/concurrencyError');

// Valid pipeline stages (must match schema enum)
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
 */
class OpportunityService {
  /**
   * Create a new Opportunity linked to a Lead (optional) or Customer
   */
  async createOpportunity({ title, leadId, customerId, branchId, assignedToId, estimatedValue, expectedCloseDate }, actor) {
    return await prisma.$transaction(async (tx) => {
      const opportunity = await tx.opportunity.create({
        data: {
          title,
          leadId: leadId || null,
          customerId: customerId || null,
          branchId,
          assignedToId: assignedToId || null,
          estimatedValue: estimatedValue ? String(estimatedValue) : null,
          expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
          stage: 'NEW',
          version: 1
        }
      });

      // Audit log entry for creation
      await tx.opportunityAuditLog.create({
        data: {
          opportunityId: opportunity.id,
          fromStage: null,
          toStage: 'NEW',
          changedById: actor?.id || null,
          changedByRole: actor?.role || 'system',
          note: 'Opportunity created'
        }
      });

      await publishEvent({
        type: 'OPPORTUNITY_CREATED',
        aggregateId: opportunity.id,
        payload: { opportunityId: opportunity.id, branchId, stage: 'NEW' },
        metadata: { tx, aggregateType: 'Opportunity', actorId: actor?.id }
      });

      return opportunity;
    });
  }

  /**
   * Change the stage of an Opportunity.
   * Uses optimistic locking (WHERE version = currentVersion) to prevent Lost Updates.
   */
  async changeStage(opportunityId, targetStage, actor, clientVersion) {
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
      const result = await tx.opportunity.updateMany({
        where: { id: opportunityId, version: versionToCheck },
        data: {
          stage: targetStage,
          version: { increment: 1 },
          closedAt: TERMINAL_STAGES.includes(targetStage) ? new Date() : null
        }
      });

      if (result.count === 0) {
        throw new ConcurrencyError('OPPORTUNITY_CONFLICT', 'تعذر تحديث المرحلة: حالة الصفقة تغيرت. يرجى تحديث الصفحة.');
      }

      // Write immutable audit trail
      await tx.opportunityAuditLog.create({
        data: {
          opportunityId,
          fromStage: opportunity.stage,
          toStage: targetStage,
          changedById: actor?.id || null,
          changedByRole: actor?.role || 'system'
        }
      });

      const eventType = targetStage === 'WON' ? 'OPPORTUNITY_WON'
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
          estimatedValue: opportunity.estimatedValue
        },
        metadata: { tx, aggregateType: 'Opportunity', actorId: actor?.id }
      });

      logger.info('[OpportunityService] Stage changed', { opportunityId, from: opportunity.stage, to: targetStage });
      return { success: true, opportunityId, fromStage: opportunity.stage, toStage: targetStage };
    });
  }

  /**
   * Get paginated pipeline for a branch (RLS enforced by Prisma extension)
   */
  async getPipeline(branchId, { stage, assignedToId, page = 1, limit = 20 } = {}) {
    const where = { branchId };
    if (stage) where.stage = stage;
    if (assignedToId) where.assignedToId = assignedToId;

    const [opportunities, total] = await Promise.all([
      prisma.opportunity.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.opportunity.count({ where })
    ]);

    return { opportunities, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /**
   * Get full stage history for a single opportunity
   */
  async getHistory(opportunityId) {
    return prisma.opportunityAuditLog.findMany({
      where: { opportunityId },
      orderBy: { createdAt: 'asc' }
    });
  }
}

module.exports = new OpportunityService();
