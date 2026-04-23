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

module.exports = prisma;
