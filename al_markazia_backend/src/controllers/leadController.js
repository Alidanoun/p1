const leadService = require('../services/leadService');
const response = require('../utils/response');
const logger = require('../utils/logger');
const { ConcurrencyError } = require('../utils/concurrencyError');

const leadController = {
  async createLead(req, res) {
    try {
      const actor = req.user;
      const branchId = req.authoritativeBranchId || req.body.branchId;
      const { name, phone, email, source, notes, assignedToId } = req.body;

      if (!name) return response.error(res, 'اسم العميل المحتمل مطلوب', 'VALIDATION_ERROR', 400);

      const lead = await leadService.createLead(
        { name, phone, email, source, notes, branchId, assignedToId },
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

  async convertLead(req, res) {
    try {
      const { id } = req.params;
      const { customerId } = req.body;
      const actor = req.user;

      if (!customerId) return response.error(res, 'customerId مطلوب', 'VALIDATION_ERROR', 400);

      const result = await leadService.convertLead(parseInt(id), parseInt(customerId), actor);
      return response.success(res, result, 'تم تحويل العميل المحتمل بنجاح');
    } catch (err) {
      if (err instanceof ConcurrencyError) {
        return response.error(res, err.message, err.code, 409);
      }
      if (err.message === 'LEAD_ALREADY_CONVERTED') {
        return response.error(res, err.message, 'LEAD_ALREADY_CONVERTED', 409);
      }
      logger.error('[LeadController] convertLead error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء تحويل العميل', 'INTERNAL_ERROR', 500);
    }
  }
};

module.exports = leadController;
