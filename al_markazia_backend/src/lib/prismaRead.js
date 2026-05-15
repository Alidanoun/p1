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

module.exports = readPrisma;
