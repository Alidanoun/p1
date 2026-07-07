const prisma = require('../lib/prisma');
const { publishEvent } = require('../events/eventPublisher');
const logger = require('../utils/logger');
const { ConcurrencyError } = require('../utils/concurrencyError');
const crypto = require('crypto');

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'LOST', 'CONVERTED'];

/**
 * 🎯 Lead Service
 * Manages prospective customers (Leads) before they convert to registered Customers.
 *
 * Design decisions:
 * - phone/email/name: auto-encrypted at rest via Prisma Extension (write hook)
 * - phoneHash / emailHash: SHA-256 for secure duplicate detection without storing plaintext
 * - All mutations enqueue an OutboxEvent within the same transaction (at-least-once delivery)
 * - convertLead uses an atomic transaction: optimistic locking prevents double-conversion
 */
class LeadService {
  /**
   * SHA-256 hash for secure duplicate lookup (same pattern as User/Customer models)
   */
  _hash(value) {
    if (!value) return null;
    return crypto.createHash('sha256').update(String(value).toLowerCase().trim()).digest('hex');
  }

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
   * Create a new Lead.
   * phone/email/name are encrypted automatically by Prisma Extension.
   * phoneHash/emailHash stored separately for deduplication queries.
   */
  async createLead({ name, phone, email, source, notes, branchId, assignedToId, customFields }, actor) {
    const phoneHash = this._hash(phone);
    const emailHash = this._hash(email);

    // Duplicate detection (phone-based — hash comparison, not plaintext)
    if (phoneHash) {
      const existing = await prisma.lead.findFirst({
        where: { phoneHash, branchId, status: { not: 'CONVERTED' } }
      });
      if (existing) {
        throw Object.assign(new Error('DUPLICATE_LEAD'), {
          statusCode: 409,
          message: 'يوجد عميل محتمل مسجل بنفس رقم الجوال في هذا الفرع.',
          existingLeadId: existing.id
        });
      }
    }

    return await prisma.$transaction(async (tx) => {
      // Validate assignee before creating
      await this._validateAssignee(tx, assignedToId, branchId);

      const lead = await tx.lead.create({
        data: {
          name,                               // ← encrypted at rest via Prisma Extension
          phone: phone || null,              // ← encrypted at rest via Prisma Extension
          email: email || null,              // ← encrypted at rest via Prisma Extension
          phoneHash,                         // ← SHA-256, used for dedup queries
          emailHash,
          source: source || 'MANUAL',
          notes,
          branchId,
          assignedToId: assignedToId || null,
          status: 'NEW',
          customFields: customFields || {}
        }
      });

      // Publish event inside the same transaction (Transactional Outbox)
      await publishEvent({
        type: 'LEAD_CREATED',
        aggregateId: lead.id,
        payload: { leadId: lead.id, branchId, source: lead.source, assignedToId },
        metadata: { tx, aggregateType: 'Lead', actorId: actor?.id }
      });

      // If assigned, fire LEAD_ASSIGNED event so notification worker can push to rep
      if (assignedToId) {
        await publishEvent({
          type: 'LEAD_ASSIGNED',
          aggregateId: lead.id,
          payload: { leadId: lead.id, assignedToId, branchId },
          metadata: { tx, aggregateType: 'Lead', actorId: actor?.id }
        });
      }

      logger.info('[LeadService] Lead created', { leadId: lead.id, branchId, assignedToId });
      return lead;
    });
  }

  /**
   * Convert a Lead to a Customer atomically.
   * Uses optimistic locking to prevent double-conversion race conditions.
   */
  async convertLead(leadId, customerId, branchId, actor) {
    const lead = await prisma.lead.findFirst({ where: { id: leadId, branchId } });
    if (!lead) throw Object.assign(new Error('LEAD_NOT_FOUND'), { statusCode: 404 });
    if (lead.status === 'CONVERTED' || lead.isConverted) {
      throw Object.assign(new Error('LEAD_ALREADY_CONVERTED'), {
        statusCode: 409,
        message: 'هذا العميل المحتمل تم تحويله مسبقاً.'
      });
    }

    return await prisma.$transaction(async (tx) => {
      const result = await tx.lead.updateMany({
        where: { id: leadId, branchId, isConverted: false, status: { not: 'CONVERTED' } },
        data: {
          status: 'CONVERTED',
          isConverted: true,
          convertedCustomerId: customerId,
          convertedAt: new Date()
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
   * Update lead status or reassign
   */
  async updateLead(leadId, { status, assignedToId, notes, customFields }, actor) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw Object.assign(new Error('LEAD_NOT_FOUND'), { statusCode: 404 });
    if (lead.status === 'CONVERTED') {
      throw Object.assign(new Error('CANNOT_UPDATE_CONVERTED'), { statusCode: 409, message: 'لا يمكن تعديل عميل محتمل تم تحويله.' });
    }
    if (status && !LEAD_STATUSES.includes(status)) {
      throw Object.assign(new Error('INVALID_STATUS'), { statusCode: 400, message: `الحالة '${status}' غير صحيحة.` });
    }

    return await prisma.$transaction(async (tx) => {
      if (assignedToId) await this._validateAssignee(tx, parseInt(assignedToId), lead.branchId);

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: {
          ...(status && { status }),
          ...(assignedToId !== undefined && { assignedToId: assignedToId || null }),
          ...(notes !== undefined && { notes }),
          ...(customFields !== undefined && { customFields })
        }
      });

      if (assignedToId && assignedToId !== lead.assignedToId) {
        await publishEvent({
          type: 'LEAD_ASSIGNED',
          aggregateId: leadId,
          payload: { leadId, assignedToId, branchId: lead.branchId },
          metadata: { tx, aggregateType: 'Lead', actorId: actor?.id }
        });
      }

      // Invalidate Customer 360 cache if converted
      if (updated.convertedCustomerId) {
        const salesActivityService = require('./salesActivityService');
        await salesActivityService.invalidateCustomer360Cache(updated.convertedCustomerId, updated.branchId);
      }

      return updated;
    });
  }

  /**
   * Search leads — supports name search (case-insensitive) + filters
   */
  async searchLeads(branchId, { query, status, assignedToId, cursor, page = 1, limit = 20 } = {}) {
    const where = { branchId };
    if (query) where.name = { contains: query, mode: 'insensitive' };
    if (status) where.status = status;
    if (assignedToId) where.assignedToId = parseInt(assignedToId);

    // Cursor-based pagination for large datasets (> 10k records)
    if (cursor) {
      const leads = await prisma.lead.findMany({
        where,
        take: parseInt(limit) + 1,
        cursor: { id: parseInt(cursor) },
        skip: 1,
        orderBy: { id: 'asc' },
        select: { id: true, name: true, source: true, status: true, notes: true, assignedToId: true, createdAt: true, convertedCustomerId: true, convertedAt: true }
      });
      const hasNextPage = leads.length > limit;
      const items = hasNextPage ? leads.slice(0, -1) : leads;
      return { leads: items, nextCursor: hasNextPage ? items[items.length - 1].id : null };
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        select: {
          id: true, name: true, source: true, status: true,
          notes: true, assignedToId: true, createdAt: true,
          convertedCustomerId: true, convertedAt: true
          // phone/email omitted from list responses — use individual GET for PII
        }
      }),
      prisma.lead.count({ where })
    ]);

    return { leads, total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) };
  }

  /**
   * Get single lead (includes decrypted phone/email via Prisma Extension)
   */
  async getLeadById(leadId, branchId) {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, branchId },
      include: {
        assignedTo: { select: { id: true, uuid: true, role: true } },
        activities: { orderBy: { activityDate: 'desc' }, take: 10 },
        opportunities: { select: { id: true, title: true, stage: true, value: true } }
      }
    });
    if (!lead) throw Object.assign(new Error('LEAD_NOT_FOUND'), { statusCode: 404 });
    return lead;
  }

  // Alias for backward compatibility
  async getLeads(branchId, filters = {}) {
    return this.searchLeads(branchId, filters);
  }

  /**
   * Soft delete a Lead
   */
  async deleteLead(leadId, branchId, actor) {
    const lead = await prisma.lead.findFirst({ where: { id: leadId, branchId } });
    if (!lead) throw Object.assign(new Error('LEAD_NOT_FOUND'), { statusCode: 404 });
    if (lead.status === 'CONVERTED') {
      throw Object.assign(new Error('CANNOT_DELETE_CONVERTED'), { statusCode: 409, message: 'لا يمكن حذف عميل محتمل تم تحويله.' });
    }

    return await prisma.$transaction(async (tx) => {
      const deleted = await tx.lead.update({
        where: { id: leadId },
        data: { isDeleted: true, deletedAt: new Date() }
      });

      await publishEvent({
        type: 'LEAD_DELETED',
        aggregateId: leadId,
        payload: { leadId, branchId },
        metadata: { tx, aggregateType: 'Lead', actorId: actor?.id }
      });

      logger.info('[LeadService] Lead soft-deleted', { leadId, branchId });
      return { success: true, leadId };
    });
  }
}

module.exports = new LeadService();
