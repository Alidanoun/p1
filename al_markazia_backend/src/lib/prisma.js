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
      email: { needs: { email: true }, compute(u) { try { return decrypt(u.email); } catch { logger.error('[Prisma] Decryption failed for user.email — returning null'); return null; } } },
      phone: { needs: { phone: true }, compute(u) { try { return decrypt(u.phone); } catch { logger.error('[Prisma] Decryption failed for user.phone — returning null'); return null; } } },
      name: { needs: { name: true }, compute(u) { try { return decrypt(u.name); } catch { logger.error('[Prisma] Decryption failed for user.name — returning null'); return null; } } }
    },
    customer: {
      email: { needs: { email: true }, compute(c) { try { return decrypt(c.email); } catch { logger.error('[Prisma] Decryption failed for customer.email — returning null'); return null; } } },
      phone: { needs: { phone: true }, compute(c) { try { return decrypt(c.phone); } catch { logger.error('[Prisma] Decryption failed for customer.phone — returning null'); return null; } } },
      name: { needs: { name: true }, compute(c) { try { return decrypt(c.name); } catch { logger.error('[Prisma] Decryption failed for customer.name — returning null'); return null; } } }
    }
  },
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        args = args || {};

        // 🛡️ Admin bypass or skip soft delete filter
        if (args.skipSoftDelete) {
          logger.security('[SoftDeleteBypass] skipSoftDelete flag used — deleted records will be visible', {
            model,
            operation,
            caller: new Error().stack?.split('\n')[2]?.trim() || 'unknown'
          });
          delete args.skipSoftDelete;
          return query(args);
        }

        // 🔒 Automatic Encryption on Write (Hardened: validates IV format, not just prefix)
        const writeActions = ['create', 'update', 'upsert', 'createMany', 'updateMany'];
        if (writeActions.includes(operation) && args.data) {
          const isAlreadyEncrypted = (val) => {
            if (typeof val !== 'string' || !val.includes(':')) return false;
            // GCM format: gcm:iv:ciphertext:tag
            if (val.startsWith('gcm:')) {
              const parts = val.split(':');
              if (parts.length !== 4) return false;
              const ivHex = parts[1];
              const tagHex = parts[3];
              return ivHex.length === 24 && tagHex.length === 32 && /^[0-9a-fA-F]+$/.test(ivHex) && /^[0-9a-fA-F]+$/.test(tagHex);
            }
            // Legacy CBC format: iv:ciphertext
            const [ivHex] = val.split(':');
            return ivHex.length === 32 && /^[0-9a-fA-F]+$/.test(ivHex);
          };

          const encryptData = (data) => {
            if (!data || typeof data !== 'object') return;
            ['email', 'phone', 'name'].forEach(field => {
              if (data[field] && typeof data[field] === 'string' && !isAlreadyEncrypted(data[field])) {
                data[field] = encrypt(data[field]);
              }
            });
          };

          if (Array.isArray(args.data)) args.data.forEach(encryptData);
          else encryptData(args.data);
        }

        // 🔍 Automatically append isDeleted: false on find operations
        const SOFT_DELETE_MODELS = [
          'FinancialLedger', 'LoyaltyLedger', 'SystemAuditLog', 'Order'
        ];
        
        if (SOFT_DELETE_MODELS.includes(model)) {
          if (['findUnique', 'findFirst', 'findMany', 'count'].includes(operation)) {
            args.where = args.where || {};
            args.where.isDeleted = false;
          }
        }

        return query(args);
      }
    }
  }
});

module.exports = prisma;
