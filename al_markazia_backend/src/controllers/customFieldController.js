const customFieldService = require('../services/customFieldService');
const response = require('../utils/response');
const logger = require('../utils/logger');

const customFieldController = {
  /**
   * Get custom field definitions for a specific entity (LEAD or OPPORTUNITY)
   */
  async getDefinitions(req, res) {
    try {
      const { entityType } = req.params;
      const branchId = req.authoritativeBranchId || req.query.branchId;

      if (!entityType || !['LEAD', 'OPPORTUNITY'].includes(entityType.toUpperCase())) {
        return response.error(res, 'نوع الكيان غير صحيح', 'VALIDATION_ERROR', 400);
      }

      const definitions = await customFieldService.getDefinitions(entityType, branchId);
      return response.success(res, definitions);
    } catch (err) {
      logger.error('[CustomFieldController] getDefinitions error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء جلب التعريفات', 'INTERNAL_ERROR', 500);
    }
  },

  /**
   * Create custom field definition (Super Admin Only)
   */
  async createDefinition(req, res) {
    try {
      const { entityType, key, label, fieldType, options, isRequired, order, branchId } = req.body;

      if (!entityType || !key || !label || !fieldType) {
        return response.error(res, 'الحقول المطلوبة: entityType, key, label, fieldType', 'VALIDATION_ERROR', 400);
      }

      if (!/^[a-zA-Z0-9_]+$/.test(key)) {
        return response.error(res, 'المفتاح التقني يجب أن يحتوي فقط على أحرف إنجليزية وأرقام وعلامة _', 'VALIDATION_ERROR', 400);
      }

      const definition = await customFieldService.createDefinition({
        entityType, key, label, fieldType, options, isRequired, order, branchId
      });

      return response.success(res, definition, 'تم إنشاء تعريف الحقل المخصص بنجاح', 201);
    } catch (err) {
      if (err.message === 'DUPLICATE_KEY') {
        return response.error(res, 'المفتاح التقني هذا مسجّل بالفعل لهذا الفرع والنوع', 'DUPLICATE_KEY', 409);
      }
      logger.error('[CustomFieldController] createDefinition error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء إنشاء تعريف الحقل المخصص', 'INTERNAL_ERROR', 500);
    }
  },

  /**
   * Update custom field definition (Super Admin Only)
   */
  async updateDefinition(req, res) {
    try {
      const { id } = req.params;
      const { label, fieldType, options, isRequired, order, isActive } = req.body;

      const updated = await customFieldService.updateDefinition(id, {
        label, fieldType, options, isRequired, order, isActive
      });

      return response.success(res, updated, 'تم تحديث تعريف الحقل المخصص بنجاح');
    } catch (err) {
      if (err.message === 'DEFINITION_NOT_FOUND') {
        return response.error(res, 'تعريف الحقل المخصص غير موجود', 'NOT_FOUND', 404);
      }
      logger.error('[CustomFieldController] updateDefinition error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء تحديث تعريف الحقل المخصص', 'INTERNAL_ERROR', 500);
    }
  },

  /**
   * Delete custom field definition (Super Admin Only - Soft Delete)
   */
  async deleteDefinition(req, res) {
    try {
      const { id } = req.params;
      const softDeleted = await customFieldService.deleteDefinition(id);
      return response.success(res, softDeleted, 'تم إيقاف/حذف تعريف الحقل المخصص بنجاح');
    } catch (err) {
      if (err.message === 'DEFINITION_NOT_FOUND') {
        return response.error(res, 'تعريف الحقل المخصص غير موجود', 'NOT_FOUND', 404);
      }
      logger.error('[CustomFieldController] deleteDefinition error', { error: err.message });
      return response.error(res, 'حدث خطأ أثناء حذف تعريف الحقل المخصص', 'INTERNAL_ERROR', 500);
    }
  }
};

module.exports = customFieldController;
