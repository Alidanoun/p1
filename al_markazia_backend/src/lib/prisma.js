const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

/**
 * 💡 Enterprise Prisma Client
 * Configured with extensions for global security and monitoring.
 */
const basePrisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'stdout', level: 'error' },
    { emit: 'stdout', level: 'warn' }
  ]
});

// 🕵️ Monitor Slow Queries
if (process.env.NODE_ENV !== 'production') {
  basePrisma.$on('query', (e) => {
    if (e.duration > 100) {
      logger.warn('⚠️ Slow Query Detected', {
        duration: `${e.duration}ms`,
        query: e.query.substring(0, 250) + '...',
      });
    }
  });
}

// 🛡️ Global Security Extension (Prisma v6 Compatible)
const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const FeatureFlagsService = require('../services/featureFlagsService');
        const { getContext } = require('../utils/securityContext');
        const SecurityPolicyService = require('../services/securityPolicyService');

        // 1. Check if enforcement is enabled
        const isEnforced = await FeatureFlagsService.isEnabled('ENFORCE_BRANCH_ISOLATION');
        if (!isEnforced) return query(args);

        // 2. Identify models and actions requiring isolation
        const modelsToSecure = ['Order', 'BranchItem', 'Branch', 'FinancialLedger', 'DailyFinancialSnapshot'];
        const actionsToSecure = ['findMany', 'findFirst', 'findUnique', 'count', 'update', 'delete', 'updateMany', 'deleteMany'];

        if (modelsToSecure.includes(model) && actionsToSecure.includes(operation)) {
          const user = getContext();
          if (user) {
            try {
              const securityFilter = await SecurityPolicyService.getHardenedFilter(user, model);
              
              // 🛡️ [SEC-FIX] For findUnique, we MUST keep unique fields at the top level
              if (operation === 'findUnique') {
                args.where = {
                  ...args.where,
                  ...securityFilter
                };
              } else {
                // For other operations, use atomic AND merge to prevent where-clause overrides
                args.where = {
                  AND: [
                    securityFilter,
                    args.where || {}
                  ]
                };
              }

              // 🕵️ Security Logging for Customer Scoping
              if (user.role?.toLowerCase() === 'customer') {
                logger.security(`[PrismaIsolation] Customer Query Scoped: ${model}.${operation}`, {
                  userId: user.id,
                  model,
                  finalWhere: JSON.stringify(args.where)
                });
              } else {
                logger.debug(`[PrismaIsolation] Applied extension filter to ${model}.${operation}`, { userId: user.id });
              }
            } catch (err) {
              logger.error('[PrismaIsolation] Extension filter failed', { 
                error: err.message, 
                userId: user.id,
                model,
                operation
              });
              
              // 🔴 SECURITY FAIL-SAFE: If filter generation fails for a restricted user, block the query
              if (user.role?.toLowerCase() !== 'super_admin') {
                throw new Error(`SECURITY_ACCESS_DENIED: ${err.message}`);
              }

              // Fail-safe for super_admins (rare)
              if (operation.includes('Many') || operation === 'count') {
                return operation === 'count' ? 0 : [];
              }
              return null;
            }
          }
        }

        return query(args);
      },
    },
  },
});

module.exports = prisma;
