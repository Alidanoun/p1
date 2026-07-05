const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

/**
 * 📖 Read-Only Prisma Client
 * Dedicated to high-throughput read operations from replicas.
 */
const readPrisma = new PrismaClient({
  datasources: {
    db: {
      url: `${process.env.READ_REPLICA_URL}${process.env.READ_REPLICA_URL.includes('?') ? '&' : '?'}connection_limit=15&pool_timeout=20`
    }
  }
});

readPrisma.$connect()
  .then(() => logger.info('📖 [PrismaRead] Successfully connected to Read Replica'))
  .catch((err) => logger.error('❌ [PrismaRead] Failed to connect to Read Replica', { error: err.message }));

const { traceContext } = require('../utils/context');
const RLS_MODELS = ['Order', 'Lead', 'Opportunity', 'SalesActivity'];

const prismaReadWithRLS = readPrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!RLS_MODELS.includes(model)) {
          return query(args);
        }

        const context = traceContext.getStore();
        const branchId = context?.branchId;
        const isAdmin = context?.isAdmin || context?.bypassRls;

        if (branchId) {
          return readPrisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SELECT set_config('app.current_branch_id', $1, true)`, String(branchId));
            return tx[model][operation](args);
          });
        }

        if (isAdmin) {
          return readPrisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_rls', 'true', true)`);
            return tx[model][operation](args);
          });
        }

        throw new Error(`[Zero-Trust] Access denied to RLS model '${model}' on Read Replica. Missing branch context or explicit admin bypass.`);
      }
    }
  }
});

module.exports = prismaReadWithRLS;
