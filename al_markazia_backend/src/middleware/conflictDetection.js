const logger = require('../utils/logger');

/**
 * 🛡️ Scoped Optimistic Concurrency Control (OCC) Middleware
 * Verifies monotonic incoming request parameters to intercept distributed updates conflicts.
 */
const conflictDetection = (modelName) => {
  return async (req, res, next) => {
    // Read operations bypass concurrency lock checking entirely
    if (req.method === 'GET' || req.method === 'OPTIONS') {
      return next();
    }

    const clientVersionHeader = req.headers['x-entity-version'];
    const clientTimestamp = req.headers['x-client-timestamp'];
    const idempotencyKey = req.headers['x-idempotency-key'];

    // If client version header omitted, assume non-offline live transaction pipeline
    if (!clientVersionHeader || isNaN(parseInt(clientVersionHeader, 10))) {
      return next();
    }

    const clientVersion = parseInt(clientVersionHeader, 10);
    const entityId = req.params?.id || req.body?.id || req.body?.orderId;

    if (!entityId || !modelName) {
      return next();
    }

    try {
      // Dynamic Prisma injection helper resolving current aggregate configurations
      const prisma = req.app?.locals?.prisma || require('../../server')?.prisma || require('../services/idempotencyService')?.prisma || null;
      
      if (!prisma || typeof prisma[modelName]?.findUnique !== 'function') {
        return next(); // Fallback continuation
      }

      // Determine clean primary query parsing
      const isNumericId = !isNaN(parseInt(entityId, 10));
      const queryWhere = isNumericId ? { id: parseInt(entityId, 10) } : (modelName === 'Order' ? { orderNumber: String(entityId) } : { uuid: String(entityId) });

      const entity = await prisma[modelName].findUnique({
        where: queryWhere
      });

      if (!entity || entity.version === undefined) {
        return next();
      }

      // Compare incoming transaction entity versions
      if (clientVersion < entity.version) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`[OCC] Detected HTTP 409 Conflict degradation target aggregate ${modelName}:${entityId}`, {
            clientVersion,
            serverVersion: entity.version,
            clientTimestamp,
            idempotencyKey
          });
        }

        return res.status(409).json({
          success: false,
          error: 'CONFLICT_STATE_DETECTED',
          message: 'تعذر تطبيق التعديل بسبب تغير حالة الكيان على الخادم أثناء انقطاع الاتصال.',
          code: 'OPTIMISTIC_CONCURRENCY_CONFLICT',
          serverState: {
            version: entity.version,
            status: entity.status || 'UNKNOWN',
            total: entity.total ? Number(entity.total) : undefined,
            walletBalance: entity.walletBalance ? Number(entity.walletBalance) : undefined,
            updatedAt: entity.updatedAt
          },
          clientVersion
        });
      }

      // Expose current synchronized server entity reference internally
      req.currentEntityVersion = entity.version;
      next();
    } catch (err) {
      if (logger && typeof logger.error === 'function') {
        logger.error(`[OCC] Scoped verification layer exception evaluating aggregate ${modelName}`, { error: err.message });
      }
      next(); // Fail-open resilience path
    }
  };
};

module.exports = conflictDetection;
