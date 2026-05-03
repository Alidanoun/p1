const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

/**
 * 💡 Enterprise Prisma Client
 * Configured with logging and query monitoring to detect N+1 problems.
 */
const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'stdout', level: 'error' },
    { emit: 'stdout', level: 'warn' }
  ]
});

// 🕵️ Monitor Slow Queries in non-production environments
if (process.env.NODE_ENV !== 'production') {
  prisma.$on('query', (e) => {
    // Log queries taking more than 100ms
    if (e.duration > 100) {
      logger.warn('⚠️ Slow Query Detected', {
        duration: `${e.duration}ms`,
        query: e.query.substring(0, 250) + '...',
        params: e.params
      });
    }
  });
}

// 🛡️ [PHASE 1] Global Security Middleware
const FeatureFlagsService = require('../services/featureFlagsService');
const SecurityPolicyService = require('../services/securityPolicyService');
const { getContext } = require('../utils/securityContext');

prisma.$use(async (params, next) => {
  // 1. Check if enforcement is enabled
  const isEnforced = await FeatureFlagsService.isEnabled('ENFORCE_BRANCH_ISOLATION');
  if (!isEnforced) return next(params);

  // 2. Identify models and actions requiring isolation
  const modelsToSecure = ['Order', 'BranchItem', 'Branch', 'Category', 'Customer'];
  const actionsToSecure = ['findMany', 'findFirst', 'findUnique', 'count', 'update', 'delete', 'updateMany', 'deleteMany'];

  if (modelsToSecure.includes(params.model) && actionsToSecure.includes(params.action)) {
    const user = getContext();
    
    if (user) {
      try {
        const securityFilter = await SecurityPolicyService.getHardenedFilter(user, params.model);
        
        // Merge security filter into the existing where clause
        params.args = params.args || {};
        params.args.where = {
          ...(params.args.where || {}),
          ...securityFilter
        };
        
        logger.debug(`[PrismaIsolation] Applied filter to ${params.model}.${params.action}`, { userId: user.id });
      } catch (err) {
        logger.error('[PrismaIsolation] Filter generation failed', { error: err.message, userId: user.id });
        // Fail-safe: If filter fails, return an empty result instead of leaking data
        if (params.action.includes('Many') || params.action === 'count') return params.action === 'count' ? 0 : [];
        return null;
      }
    }
  }

  return next(params);
});

module.exports = prisma;
