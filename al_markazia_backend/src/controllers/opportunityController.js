const opportunityService = require('../services/opportunityService');
const response = require('../utils/response');
const logger = require('../utils/logger');
const { ConcurrencyError } = require('../utils/concurrencyError');

const opportunityController = {
  async createOpportunity(req, res) {
    try {
      const actor = req.user;
      const branchId = req.authoritativeBranchId || req.body.branchId;
      const { title, leadId, customerId, assignedToId, estimatedValue, expectedCloseDate } = req.body;

      if (!title) return response.error(res, 'عنوان الصفقة مطلوب', 'VALIDATION_ERROR', 400);
      if (!leadId && !customerId) return response.error(res, 'يجب ربط الصفقة بعميل محتمل أو عميل مسجل', 'VALIDATION_ERROR', 400);

      const opportunity = await opportunityService.createOpportunity(
        { title, leadId, customerId, branchId, assignedToId, estimatedValue, expectedCloseDate },
        actor
      );
      return response.success(res, opportunity, 'تم إنشاء الصفقة بنجاح', 201);
    } catch (err) {
      logger.error('[OpportunityController] createOpportunity error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء إنشاء الصفقة', 'INTERNAL_ERROR', 500);
    }
  },

  async getPipeline(req, res) {
    try {
      const branchId = req.authoritativeBranchId;
      const { stage, assignedToId, page, limit } = req.query;
      const result = await opportunityService.getPipeline(branchId, { stage, assignedToId, page, limit });
      return response.success(res, result);
    } catch (err) {
      logger.error('[OpportunityController] getPipeline error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء جلب خط الأنابيب', 'INTERNAL_ERROR', 500);
    }
  },

  async changeStage(req, res) {
    try {
      const { id } = req.params;
      const { stage } = req.body;
      const actor = req.user;
      // Read client version from header (set by conflictDetection middleware)
      const clientVersion = req.headers['x-entity-version'] || req.currentEntityVersion;

      if (!stage) return response.error(res, 'المرحلة المستهدفة مطلوبة', 'VALIDATION_ERROR', 400);

      const result = await opportunityService.changeStage(parseInt(id), stage, actor, clientVersion);
      return response.success(res, result, 'تم تحديث مرحلة الصفقة بنجاح');
    } catch (err) {
      if (err instanceof ConcurrencyError) {
        return response.error(res, err.message, err.code, 409);
      }
      if (['INVALID_STAGE', 'INVALID_STAGE_TRANSITION', 'STAGE_TERMINAL'].includes(err.message)) {
        return response.error(res, err.message, err.message, 409);
      }
      logger.error('[OpportunityController] changeStage error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء تحديث المرحلة', 'INTERNAL_ERROR', 500);
    }
  },

  async getHistory(req, res) {
    try {
      const { id } = req.params;
      const history = await opportunityService.getHistory(parseInt(id));
      return response.success(res, history);
    } catch (err) {
      logger.error('[OpportunityController] getHistory error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء جلب سجل الصفقة', 'INTERNAL_ERROR', 500);
    }
  }
};

module.exports = opportunityController;
