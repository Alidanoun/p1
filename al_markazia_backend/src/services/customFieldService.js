const { z } = require('zod');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const redis = require('../lib/redis');

class CustomFieldService {
  /**
   * Helper to get cache key for definitions
   */
  _getCacheKey(entityType, branchId) {
    return `crm:custom-fields:definitions:${entityType}:${branchId || 'global'}`;
  }

  /**
   * Invalidate definitions cache
   */
  async _invalidateCache(entityType, branchId) {
    const key = this._getCacheKey(entityType, branchId);
    await redis.del(key).catch(err => logger.error(`[CustomFieldService] Cache invalidation error`, { error: err.message }));
  }

  /**
   * Get all active definitions for an entity type and branch (including global ones)
   */
  async getDefinitions(entityType, branchId = null) {
    const cacheKey = this._getCacheKey(entityType, branchId);
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.error(`[CustomFieldService] Error reading definitions cache`, { error: err.message });
    }

    const defs = await prisma.customFieldDefinition.findMany({
      where: {
        entityType: entityType.toUpperCase(),
        isActive: true,
        OR: [
          { branchId: branchId || undefined },
          { branchId: null }
        ]
      },
      orderBy: { order: 'asc' }
    });

    try {
      await redis.set(cacheKey, JSON.stringify(defs), 'EX', 3600); // 1 hour cache
    } catch (err) {
      logger.error(`[CustomFieldService] Error setting definitions cache`, { error: err.message });
    }

    return defs;
  }

  /**
   * Build Zod schema dynamically from database definitions
   */
  async buildCustomFieldsSchema(entityType, branchId) {
    const defs = await this.getDefinitions(entityType, branchId);
    const shape = {};

    for (const def of defs) {
      let validator;
      switch (def.fieldType.toUpperCase()) {
        case 'NUMBER':
          validator = z.coerce.number({ invalid_type_error: `${def.label} يجب أن يكون رقماً` });
          break;
        case 'DATE':
          validator = z.preprocess((val) => {
            if (!val) return undefined;
            return new Date(val);
          }, z.date({ invalid_type_error: `${def.label} يجب أن يكون تاريخاً صحيحاً` }));
          break;
        case 'BOOLEAN':
          validator = z.preprocess((val) => {
            if (typeof val === 'string') {
              if (val.toLowerCase() === 'true') return true;
              if (val.toLowerCase() === 'false') return false;
            }
            return val;
          }, z.boolean({ invalid_type_error: `${def.label} يجب أن يكون منطقياً (True/False)` }));
          break;
        case 'SELECT':
          const opts = Array.isArray(def.options) ? def.options : (typeof def.options === 'string' ? JSON.parse(def.options) : []);
          if (opts.length > 0) {
            validator = z.enum(opts, { errorMap: () => ({ message: `${def.label} الاختيار غير صالح` }) });
          } else {
            validator = z.string();
          }
          break;
        case 'TEXT':
        default:
          validator = z.string().min(1, `${def.label} لا يمكن أن يكون فارغاً`);
          break;
      }

      shape[def.key] = def.isRequired ? validator : validator.optional().nullable();
    }

    return z.object(shape).strict();
  }

  /**
   * Validate custom fields inputs
   */
  async validateCustomFields(entityType, branchId, customFields = {}) {
    // If no custom fields are passed, default to empty object
    const fieldsToValidate = customFields || {};
    const schema = await this.buildCustomFieldsSchema(entityType, branchId);
    return schema.parse(fieldsToValidate);
  }

  // ─── CRUD definitions (Super Admin Only) ───────────────────────────────────

  async createDefinition(data) {
    const { entityType, key, label, fieldType, options, isRequired, order, branchId } = data;
    
    // Ensure key is unique per branch/entityType
    const existing = await prisma.customFieldDefinition.findFirst({
      where: {
        entityType: entityType.toUpperCase(),
        key,
        branchId: branchId || null
      }
    });

    if (existing) {
      throw new Error('DUPLICATE_KEY');
    }

    const definition = await prisma.customFieldDefinition.create({
      data: {
        entityType: entityType.toUpperCase(),
        key,
        label,
        fieldType: fieldType.toUpperCase(),
        options: options ? (Array.isArray(options) ? options : JSON.parse(options)) : null,
        isRequired: !!isRequired,
        order: order || 0,
        branchId: branchId || null
      }
    });

    await this._invalidateCache(entityType, branchId);
    return definition;
  }

  async updateDefinition(id, data) {
    const { label, fieldType, options, isRequired, order, isActive } = data;

    const existing = await prisma.customFieldDefinition.findUnique({
      where: { id: parseInt(id) }
    });

    if (!existing) {
      throw new Error('DEFINITION_NOT_FOUND');
    }

    const updated = await prisma.customFieldDefinition.update({
      where: { id: parseInt(id) },
      data: {
        label: label !== undefined ? label : existing.label,
        fieldType: fieldType !== undefined ? fieldType.toUpperCase() : existing.fieldType,
        options: options !== undefined ? (Array.isArray(options) ? options : JSON.parse(options)) : existing.options,
        isRequired: isRequired !== undefined ? !!isRequired : existing.isRequired,
        order: order !== undefined ? order : existing.order,
        isActive: isActive !== undefined ? !!isActive : existing.isActive
      }
    });

    await this._invalidateCache(existing.entityType, existing.branchId);
    return updated;
  }

  /**
   * Soft delete definition as requested by user (isActive = false)
   */
  async deleteDefinition(id) {
    const existing = await prisma.customFieldDefinition.findUnique({
      where: { id: parseInt(id) }
    });

    if (!existing) {
      throw new Error('DEFINITION_NOT_FOUND');
    }

    const softDeleted = await prisma.customFieldDefinition.update({
      where: { id: parseInt(id) },
      data: { isActive: false }
    });

    await this._invalidateCache(existing.entityType, existing.branchId);
    return softDeleted;
  }
}

module.exports = new CustomFieldService();
