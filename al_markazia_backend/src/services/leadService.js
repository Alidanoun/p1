const prisma = require('../lib/prisma');
const { publishEvent } = require('../events/eventPublisher');
const logger = require('../utils/logger');
const { ConcurrencyError } = require('../utils/concurrencyError');
const crypto = require('crypto');

/**
 * 🎯 Lead Service
 * Manages prospective customers (Leads) before they convert to registered Customers.
 *
 * Design decisions:
 * - phoneHash / emailHash: hashed for secure querying (detect duplicates without storing plaintext)
 * - All mutations enqueue an OutboxEvent within the same transaction (at-least-once delivery)
 * - convertLead uses an atomic transaction: marks lead as CONVERTED + links customerId
 */
class LeadService {
  /**
   * Hash a value using SHA-256 for secure lookups (same pattern as User model)
   */
  _hash(value) {
    if (!value) return null;
    return crypto.createHash('sha256').update(String(value).toLowerCase().trim()).digest('hex');
  }

  /**
   * Create a new Lead.
   * Checks for duplicate phone hash before creating.
   */
  async createLead({ name, phone, email, source, notes, branchId, assignedToId }, actor) {
    const phoneHash = this._hash(phone);
    const emailHash = this._hash(email);

    // Duplicate detection (phone-based)
    if (phoneHash) {
      const existing = await prisma.lead.findFirst({
        where: { phoneHash, branchId, status: { not: 'CONVERTED' } }
      });
      if (existing) {
        throw Object.assign(new Error('DUPLICATE_LEAD'), {
          statusCode: 409,
          message: `يوجد عميل محتمل مسجل بنفس رقم الجوال في هذا الفرع.`,
          existingLeadId: existing.id
        });
      }
    }

    return await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          name,
          phone: phone || null,  // raw phone optional; hash is the source of truth for dedup
          phoneHash,
          emailHash,
          source: source || 'MANUAL',
          notes,
          branchId,
          assignedToId: assignedToId || null,
          status: 'NEW'
        }
      });

      // Publish event inside the same transaction (Transactional Outbox)
      await publishEvent({
        type: 'LEAD_CREATED',
        aggregateId: lead.id,
        payload: { leadId: lead.id, branchId, source: lead.source, assignedToId },
        metadata: { tx, aggregateType: 'Lead', actorId: actor?.id }
      });

      logger.info('[LeadService] Lead created', { leadId: lead.id, branchId });
      return lead;
    });
  }

  /**
   * Convert a Lead to a Customer atomically.
   * Uses optimistic locking (version check) to prevent double-conversion.
   */
  async convertLead(leadId, customerId, actor) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw Object.assign(new Error('LEAD_NOT_FOUND'), { statusCode: 404 });
    if (lead.status === 'CONVERTED') {
      throw Object.assign(new Error('LEAD_ALREADY_CONVERTED'), {
        statusCode: 409,
        message: 'هذا العميل المحتمل تم تحويله مسبقاً.'
      });
    }

    return await prisma.$transaction(async (tx) => {
      const result = await tx.lead.updateMany({
        where: { id: leadId, version: lead.version, status: { not: 'CONVERTED' } },
        data: {
          status: 'CONVERTED',
          convertedCustomerId: customerId,
          convertedAt: new Date(),
          version: { increment: 1 }
        }
      });

      if (result.count === 0) {
        throw new ConcurrencyError('LEAD_CONVERSION_CONFLICT', 'تعذر تحويل العميل المحتمل. قد تكون حالته تغيرت.');
      }

      await publishEvent({
        type: 'LEAD_CONVERTED',
        aggregateId: leadId,
        payload: { leadId, customerId, branchId: lead.branchId },
        metadata: { tx, aggregateType: 'Lead', actorId: actor?.id }
      });

      logger.info('[LeadService] Lead converted', { leadId, customerId });
      return { success: true, leadId, customerId };
    });
  }

  /**
   * Get paginated leads for a branch (RLS enforced by Prisma extension)
   */
  async getLeads(branchId, { status, assignedToId, page = 1, limit = 20 } = {}) {
    const where = { branchId };
    if (status) where.status = status;
    if (assignedToId) where.assignedToId = assignedToId;

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, name: true, source: true, status: true,
          notes: true, assignedToId: true, createdAt: true,
          convertedCustomerId: true, convertedAt: true
          // Note: phone omitted intentionally — use phoneHash for lookups
        }
      }),
      prisma.lead.count({ where })
    ]);

    return { leads, total, page, limit, pages: Math.ceil(total / limit) };
  }
}

module.exports = new LeadService();
