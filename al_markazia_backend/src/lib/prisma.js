const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const { encrypt, decrypt } = require('../utils/crypto');

/**
 * 💎 Optimized Prisma Client (Production Grade)
 * Implements:
 * 1. Connection Pooling (20 connections)
 * 2. Automatic Field Encryption/Decryption for sensitive data
 * 3. Slow Query Performance Logging
 */
const basePrisma = new PrismaClient({
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

// ⏱️ Slow Query Monitoring
basePrisma.$on('query', (e) => {
  if (e.duration > 300) {
    logger.warn('⚠️ Slow Query Detected', {
      duration: `${e.duration}ms`,
      query: e.query.substring(0, 500),
    });
  }
});

const prisma = basePrisma.$extends({
  // 🔓 Automatic Decryption on Read
  result: {
    user: {
      email: { needs: { email: true }, compute(u) { try { return decrypt(u.email); } catch { return u.email; } } },
      phone: { needs: { phone: true }, compute(u) { try { return decrypt(u.phone); } catch { return u.phone; } } },
      name: { needs: { name: true }, compute(u) { try { return decrypt(u.name); } catch { return u.name; } } }
    },
    customer: {
      email: { needs: { email: true }, compute(c) { try { return decrypt(c.email); } catch { return c.email; } } },
      phone: { needs: { phone: true }, compute(c) { try { return decrypt(c.phone); } catch { return c.phone; } } },
      name: { needs: { name: true }, compute(c) { try { return decrypt(c.name); } catch { return c.name; } } }
    }
  },
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        args = args || {};

        // 🛡️ Admin bypass or skip soft delete filter
        if (args.skipSoftDelete) {
          delete args.skipSoftDelete;
          return query(args);
        }

        // 🔍 Automatically append isDeleted: false on find operations
        const SOFT_DELETE_MODELS = [
          'FinancialLedger', 'LoyaltyLedger', 'SystemAuditLog', 
          'Order', 'OrderItem', 'BranchItem'
        ];
        
        if (SOFT_DELETE_MODELS.includes(model)) {
          if (['findUnique', 'findFirst', 'findMany', 'count'].includes(operation)) {
            args.where = args.where || {};
            args.where.isDeleted = false;
          }
        }

        // 🔒 Automatic Encryption on Write
        const writeActions = ['create', 'update', 'upsert', 'createMany', 'updateMany'];
        if (writeActions.includes(operation) && args.data) {
          const encryptData = (data) => {
            if (!data || typeof data !== 'object') return;
            ['email', 'phone', 'name'].forEach(field => {
              if (data[field] && typeof data[field] === 'string' && !data[field].startsWith('iv:')) {
                data[field] = encrypt(data[field]);
              }
            });
          };

          if (Array.isArray(args.data)) args.data.forEach(encryptData);
          else encryptData(args.data);
        }

        return query(args);
      }
    }
  }
});

module.exports = prisma;
