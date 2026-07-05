const salesActivityService = require('../services/salesActivityService');
const response = require('../utils/response');
const logger = require('../utils/logger');

const salesActivityController = {
  async logActivity(req, res) {
    try {
      const actor = req.user;
      const branchId = req.authoritativeBranchId;
      const { type, subject, notes, leadId, customerId, opportunityId, scheduledAt } = req.body;

      if (!type) return response.error(res, 'نوع النشاط مطلوب', 'VALIDATION_ERROR', 400);

      const activity = await salesActivityService.logActivity(
        { type, subject, notes, leadId, customerId, opportunityId, branchId, scheduledAt },
        actor
      );
      return response.success(res, activity, 'تم تسجيل النشاط بنجاح', 201);
    } catch (err) {
      if (['INVALID_ACTIVITY_TYPE', 'ENTITY_REQUIRED'].includes(err.message)) {
        return response.error(res, err.message, err.message, 400);
      }
      logger.error('[SalesActivityController] logActivity error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء تسجيل النشاط', 'INTERNAL_ERROR', 500);
    }
  },

  async getActivities(req, res) {
    try {
      const branchId = req.authoritativeBranchId;
      const { leadId, customerId, opportunityId, type, page, limit } = req.query;
      const result = await salesActivityService.getActivities(branchId, { leadId, customerId, opportunityId, type, page, limit });
      return response.success(res, result);
    } catch (err) {
      logger.error('[SalesActivityController] getActivities error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء جلب الأنشطة', 'INTERNAL_ERROR', 500);
    }
  },

  async getLeadTimeline(req, res) {
    try {
      const { id } = req.params;
      const branchId = req.authoritativeBranchId;
      const result = await salesActivityService.getLeadTimeline(id, branchId);
      return response.success(res, result);
    } catch (err) {
      if (err.message === 'LEAD_NOT_FOUND') return response.error(res, 'العميل المحتمل غير موجود', 'NOT_FOUND', 404);
      logger.error('[SalesActivityController] getLeadTimeline error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء جلب الجدول الزمني', 'INTERNAL_ERROR', 500);
    }
  },

  async getCustomer360(req, res) {
    try {
      const { id } = req.params;
      const branchId = req.authoritativeBranchId;
      const result = await salesActivityService.getCustomer360(id, branchId);
      return response.success(res, result);
    } catch (err) {
      if (err.message === 'CUSTOMER_NOT_FOUND') return response.error(res, 'العميل غير موجود', 'NOT_FOUND', 404);
      logger.error('[SalesActivityController] getCustomer360 error', { error: err.message });
      return response.error(res, 'حدث خطأ', 'INTERNAL_ERROR', 500);
    }
  }
};

module.exports = salesActivityController;
