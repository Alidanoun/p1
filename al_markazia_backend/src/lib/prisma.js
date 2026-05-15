const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const { encrypt, decrypt } = require('../utils/crypto');

/**
 * 💡 Enterprise Prisma Client
 * Configured with extensions for global security and monitoring.
 */
const basePrisma = new PrismaClient({
  // 🚀 [PERF-FIX] Connection Pooling Configuration
  // Ensures stability under peak load by managing concurrent DB connections.
  datasources: {
    db: {
      url: `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes('?') ? '&' : '?'}connection_limit=20&pool_timeout=30`
    }
  },
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
  // 1. Transparent Decryption (Read)
  result: {
    user: {
      email: { needs: { email: true }, compute(u) { return decrypt(u.email); } },
      phone: { needs: { phone: true }, compute(u) { return decrypt(u.phone); } },
      fcmToken: { needs: { fcmToken: true }, compute(u) { return decrypt(u.fcmToken); } }
    },
    customer: {
      email: { needs: { email: true }, compute(c) { return decrypt(c.email); } },
      phone: { needs: { phone: true }, compute(c) { return decrypt(c.phone); } },
      fcmToken: { needs: { fcmToken: true }, compute(c) { return decrypt(c.fcmToken); } }
    }
  },
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // ─── Phase 0: Transparent Encryption (Write) ─────────
        const writeActions = ['create', 'update', 'upsert', 'createMany', 'updateMany', 'delete', 'deleteMany'];
        if (writeActions.includes(operation) && args.data) {
          const sensitiveFields = ['email', 'phone', 'fcmToken'];
          
          // Handle single data object
          const encryptData = (data) => {
            if (!data || typeof data !== 'object') return;
            sensitiveFields.forEach(field => {
              if (data[field]) data[field] = encrypt(data[field]);
            });
          };

          if (Array.isArray(args.data)) {
            args.data.forEach(encryptData);
          } else {
            encryptData(args.data);
          }
        }

        // ⏱️ [PERF-FIX] Programmatic Query Timeout
        const TIMEOUT_MS = 25000;
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`PRISMA_TIMEOUT: ${model}.${operation} exceeded ${TIMEOUT_MS}ms`));
          }, TIMEOUT_MS);
        });

        const executeQuery = async () => {
          const FeatureFlagsService = require('../services/featureFlagsService');
          const { getContext } = require('../utils/securityContext');
          const SecurityPolicyService = require('../services/securityPolicyService');

          // 🏛️ [PHASE 6] Read Replica Routing
          const readActions = ['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy'];
          const isReadOperation = readActions.includes(operation);
          
          // Use Primary by default
          let targetQuery = query;

          if (isReadOperation && process.env.READ_REPLICA_URL) {
            const useReplica = await FeatureFlagsService.isEnabled('ENABLE_READ_REPLICA_ROUTING');
            if (useReplica) {
              // 🧪 Dynamic Read Routing: Using separate client for reads
              // We use a global singleton to avoid connection explosion
              const readClient = require('./prismaRead');
              targetQuery = (args) => readClient[model][operation](args);
              logger.debug(`[PrismaRouting] Redirected ${model}.${operation} to Read Replica`);
            }
          }

          // 1. Check if enforcement is enabled
          const isEnforced = await FeatureFlagsService.isEnabled('ENFORCE_BRANCH_ISOLATION');
          if (!isEnforced) return targetQuery(args);

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
                  args.where = { ...args.where, ...securityFilter };
                } else {
                  // For other operations, use atomic AND merge to prevent where-clause overrides
                  args.where = {
                    AND: [ securityFilter, args.where || {} ]
                  };
                }

                // 🕵️ Security Logging
                if (user.role?.toLowerCase() === 'customer') {
                  logger.security(`[PrismaIsolation] Customer Query Scoped: ${model}.${operation}`, {
                    userId: user.id, model, finalWhere: JSON.stringify(args.where)
                  });
                }
              } catch (err) {
                logger.error('[PrismaIsolation] Extension filter failed', { 
                  error: err.message, userId: user.id, model, operation
                });
                
                if (user.role?.toLowerCase() !== 'admin') {
                  throw new Error(`SECURITY_ACCESS_DENIED: ${err.message}`);
                }

                if (operation.includes('Many') || operation === 'count') {
                  return operation === 'count' ? 0 : [];
                }
                return null;
              }
            }
          }

          return targetQuery(args);
        };

        try {
          const result = await Promise.race([executeQuery(), timeoutPromise]);
          clearTimeout(timeoutId);
          return result;
        } catch (error) {
          clearTimeout(timeoutId);
          if (error.message.includes('PRISMA_TIMEOUT')) {
            logger.error('❌ Prisma Query Timeout', { model, operation, timeout: TIMEOUT_MS });
          }
          throw error;
        }
      },
    },
  },
});

module.exports = prisma;
