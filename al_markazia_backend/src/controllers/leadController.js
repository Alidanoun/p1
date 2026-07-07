const leadService = require('../services/leadService');
const response = require('../utils/response');
const logger = require('../utils/logger');
const { ConcurrencyError } = require('../utils/concurrencyError');

const leadController = {
  async createLead(req, res) {
    try {
      const actor = req.user;
      const branchId = req.authoritativeBranchId || req.body.branchId;
      const { name, phone, email, source, notes, assignedToId, customFields } = req.body;

      if (!name) return response.error(res, 'اسم العميل المحتمل مطلوب', 'VALIDATION_ERROR', 400);

      // Validate Custom Fields
      const customFieldService = require('../services/customFieldService');
      let validatedCustomFields = {};
      try {
        validatedCustomFields = await customFieldService.validateCustomFields('LEAD', branchId, customFields);
      } catch (validationError) {
        return response.error(res, validationError.errors?.[0]?.message || 'التحقق من الحقول المخصصة فشل', 'VALIDATION_ERROR', 400, { details: validationError.errors });
      }

      const lead = await leadService.createLead(
        { name, phone, email, source, notes, branchId, assignedToId, customFields: validatedCustomFields },
        actor
      );
      return response.success(res, lead, 'تم إضافة العميل المحتمل بنجاح', 201);
    } catch (err) {
      if (err.message === 'DUPLICATE_LEAD') {
        return response.error(res, err.message, 'DUPLICATE_LEAD', 409, { existingLeadId: err.existingLeadId });
      }
      logger.error('[LeadController] createLead error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء إضافة العميل المحتمل', 'INTERNAL_ERROR', 500);
    }
  },

  async getLeads(req, res) {
    try {
      const branchId = req.authoritativeBranchId;
      const { status, assignedToId, page, limit } = req.query;
      const result = await leadService.getLeads(branchId, { status, assignedToId, page, limit });
      return response.success(res, result);
    } catch (err) {
      logger.error('[LeadController] getLeads error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء جلب العملاء المحتملين', 'INTERNAL_ERROR', 500);
    }
  },

  async getLeadById(req, res) {
    try {
      const { id } = req.params;
      const branchId = req.authoritativeBranchId;
      const lead = await leadService.getLeadById(parseInt(id), branchId);
      return response.success(res, lead);
    } catch (err) {
      if (err.message === 'LEAD_NOT_FOUND') return response.error(res, 'العميل المحتمل غير موجود', 'NOT_FOUND', 404);
      logger.error('[LeadController] getLeadById error', { error: err.message });
      return response.error(res, 'حدث خطأ', 'INTERNAL_ERROR', 500);
    }
  },

  async updateLead(req, res) {
    try {
      const { id } = req.params;
      const actor = req.user;
      const { status, assignedToId, notes, customFields } = req.body;

      // Validate Custom Fields on merged data
      let validatedCustomFields = undefined;
      if (customFields !== undefined) {
        const lead = await leadService.getLeadById(parseInt(id), req.authoritativeBranchId);
        const merged = { ...(lead.customFields || {}), ...customFields };
        const customFieldService = require('../services/customFieldService');
        try {
          validatedCustomFields = await customFieldService.validateCustomFields('LEAD', lead.branchId, merged);
        } catch (validationError) {
          return response.error(res, validationError.errors?.[0]?.message || 'التحقق من الحقول المخصصة فشل', 'VALIDATION_ERROR', 400, { details: validationError.errors });
        }
      }

      const updated = await leadService.updateLead(parseInt(id), { status, assignedToId, notes, customFields: validatedCustomFields }, actor);
      return response.success(res, updated, 'تم تحديث العميل المحتمل');
    } catch (err) {
      if (err instanceof ConcurrencyError) return response.error(res, err.message, err.code, 409);
      if (['LEAD_NOT_FOUND', 'CANNOT_UPDATE_CONVERTED', 'INVALID_STATUS', 'INVALID_ASSIGNMENT'].includes(err.message)) {
        return response.error(res, err.message, err.message, err.statusCode || 400);
      }
      logger.error('[LeadController] updateLead error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء تحديث العميل المحتمل', 'INTERNAL_ERROR', 500);
    }
  },

  async convertLead(req, res) {
    try {
      const { id } = req.params;
      const { customerId } = req.body;
      const actor = req.user;
      const branchId = req.authoritativeBranchId;

      if (!customerId) return response.error(res, 'customerId مطلوب', 'VALIDATION_ERROR', 400);

      const result = await leadService.convertLead(parseInt(id), parseInt(customerId), branchId, actor);
      return response.success(res, result, 'تم تحويل العميل المحتمل بنجاح');
    } catch (err) {
      if (err instanceof ConcurrencyError) {
        return response.error(res, err.message, err.code, 409);
      }
      if (err.message === 'LEAD_ALREADY_CONVERTED') {
        return response.error(res, err.message, 'LEAD_ALREADY_CONVERTED', 409);
      }
      if (err.code === 'P2003') {
        return response.error(res, 'العميل المدخل غير موجود في النظام', 'CUSTOMER_NOT_FOUND', 400);
      }
      logger.error('[LeadController] convertLead error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء تحويل العميل', 'INTERNAL_ERROR', 500);
    }
  },

  async deleteLead(req, res) {
    try {
      const { id } = req.params;
      const branchId = req.authoritativeBranchId;
      const actor = req.user;
      
      const result = await leadService.deleteLead(parseInt(id), branchId, actor);
      return response.success(res, result, 'تم حذف العميل المحتمل بنجاح');
    } catch (err) {
      if (err.message === 'LEAD_NOT_FOUND') return response.error(res, 'العميل المحتمل غير موجود', 'NOT_FOUND', 404);
      if (err.message === 'CANNOT_DELETE_CONVERTED') return response.error(res, err.message, 'CONFLICT', 409);
      logger.error('[LeadController] deleteLead error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء حذف العميل المحتمل', 'INTERNAL_ERROR', 500);
    }
  }
};

module.exports = leadController;
