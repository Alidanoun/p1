const redis = require('../lib/redis');
const logger = require('../utils/logger');

/**
 * 🛡️ Security Policy Service (The Fortress)
 * The single source of truth for all authorization and data isolation logic.
 */
class SecurityPolicyService {
  /**
   * Generates a hardened filter for database queries based on user context.
   * @param {Object} user - The requesting user from JWT.
   * @param {string} modelName - The Prisma model name being queried.
   * @returns {Promise<Object>} Prisma where clause filter.
   */
  static async getHardenedFilter(user, modelName = 'Generic') {
    if (!user) throw new Error('UNAUTHORIZED: No security context provided');

    // 🛡️ [PHASE 2] Context Integrity Validation
    if (!user.id || !user.role) {
      logger.security('INVALID_SECURITY_CONTEXT', { user, modelName });
      throw new Error('INVALID_SECURITY_CONTEXT');
    }

    const normalizedRole = user.role.toLowerCase();
    const ALLOWED_ROLES = ['super_admin', 'admin', 'branch_manager', 'manager', 'customer', 'staff', 'driver'];

    if (!ALLOWED_ROLES.includes(normalizedRole)) {
      logger.security('UNAUTHORIZED_ROLE_ACCESS', { userId: user.id, role: user.role, modelName });
      throw new Error('INVALID_USER_ROLE');
    }

    // 👑 Super Admin: Absolute Visibility (Bypass branch isolation)
    if (normalizedRole === 'super_admin') {
      const modelsWithSoftDelete = ['Order', 'Item', 'Category', 'Customer'];
      return modelsWithSoftDelete.includes(modelName) ? { isDeleted: false } : {};
    }

    // 🎯 Model-Aware Field Selection (Initialize filter)
    const filter = {};

    // 1. Soft Delete Layer (Only apply to models that support it)
    const modelsWithSoftDelete = ['Order', 'Item', 'Category', 'Customer'];
    if (modelsWithSoftDelete.includes(modelName)) {
      filter.isDeleted = false;
    }

    // 🛡️ [PHASE 3] Zero-Trust Data Isolation (Customer Layer)
    if (normalizedRole === 'customer') {
      const ownershipMap = {
        Order: { field: 'customer', subField: 'uuid', value: user.id }, // Map to customer relation uuid
        OrderItem: { relation: 'order', field: 'customer', subField: 'uuid', value: user.id },
        Review: { field: 'customer', subField: 'uuid', value: user.id },
        Customer: { field: 'uuid', value: user.id }, // Customers can only see their own profile
        // Public models (Browsing)
        Branch: null,
        Item: null,
        Category: null,
        RewardStoreItem: null,
        DeliveryZone: null
      };

      const rule = ownershipMap[modelName];
      
      // 🟢 Case A: Publicly accessible model
      if (rule === null) return filter;

      // 🔴 Case B: Missing Isolation Rule (Fail-Safe)
      if (!rule) {
        logger.security('MISSING_CUSTOMER_ISOLATION_RULE', { userId: user.id, modelName });
        throw new Error(`SECURITY_ERROR: Missing isolation rule for model ${modelName}`);
      }

      // 🔵 Case C: Apply Ownership Filter
      if (rule.relation) {
        // Nested relation filter (e.g., OrderItem -> order -> customer -> uuid)
        filter[rule.relation] = {
          [rule.field]: {
            [rule.subField]: rule.value
          }
        };
      } else if (rule.subField) {
        // Direct object filter (e.g., Order -> customer -> uuid)
        filter[rule.field] = {
          [rule.subField]: rule.value
        };
      } else {
        // Direct field filter (e.g., Customer -> uuid)
        filter[rule.field] = rule.value;
      }

      return filter;
    }

    let allowedBranchIds = [];

    // 🏢 Admin / Manager: Access to assigned branch + any sub-branches
    if (['admin', 'branch_manager', 'manager'].includes(normalizedRole)) {
      if (user.branchId) allowedBranchIds.push(user.branchId);

      const cacheKey = `user:branches:${user.id}`;
      const cached = await redis.get(cacheKey);

      if (cached) {
        const extraIds = JSON.parse(cached);
        allowedBranchIds = [...new Set([...allowedBranchIds, ...extraIds])];
      } else {
        const prisma = require('../lib/prisma'); // 🛡️ Local require to break circular dependency
        
        // 🛡️ [SECURITY-FIX] Identity Resolution (Number vs UUID)
        let numericUserId = typeof user.id === 'number' ? user.id : null;
        
        if (!numericUserId && typeof user.id === 'string' && !isNaN(user.id)) {
           numericUserId = parseInt(user.id);
        }

        if (!numericUserId) {
          // If it's a UUID string, look up the numeric ID
          const userRecord = await prisma.user.findUnique({ 
            where: { uuid: user.id }, 
            select: { id: true } 
          });
          if (userRecord) numericUserId = userRecord.id;
        }

        if (numericUserId) {
          const linkedBranches = await prisma.userBranch.findMany({
            where: { userId: numericUserId },
            select: { branchId: true }
          });
          const extraIds = linkedBranches.map(lb => lb.branchId);
          await redis.setex(cacheKey, 300, JSON.stringify(extraIds)); // 🛡️ 5-minute TTL for security
          allowedBranchIds = [...new Set([...allowedBranchIds, ...extraIds])];
        } else {
          logger.security('IDENTITY_RESOLUTION_FAILED', { userId: user.id, role: user.role });
        }
      }
    } else {
      if (user.branchId) allowedBranchIds.push(user.branchId);
    }

    // 🛡️ Strict Isolation Enforcement
    if (allowedBranchIds.length === 0) {
      logger.warn('[SecurityPolicy] Blocked attempt: User has no branch context', { userId: user.id, role: user.role });
      // 🛡️ [FAIL-SAFE] Using { in: [] } is type-safe for both Int and String IDs in Prisma
      return { id: { in: [] }, ...filter };
    }

    // Apply branch filters based on model type
    const branchIsolationModels = ['Order', 'BranchItem', 'FinancialLedger', 'DailyFinancialSnapshot'];
    if (branchIsolationModels.includes(modelName)) {
      filter.branchId = { in: allowedBranchIds };
    } else if (modelName === 'Branch') {
      filter.id = { in: allowedBranchIds };
    }

    return filter;
  }

  /**
   * Identifies target Socket.IO rooms for a user or an event.
   * @param {Object} context - User object or Event metadata.
   * @returns {Promise<string[]>} List of room identifiers.
   */
  static async getTargetRooms(context) {
    const rooms = new Set();

    // Case 1: Context is a User (for joining rooms on connect)
    if (context.id && context.role) {
      rooms.add(`room:user:${context.id}`);

      if (['super_admin', 'admin'].includes(context.role)) {
        rooms.add('room:admin:global');
      }

      if (context.branchId) {
        rooms.add(`room:admin:branch:${context.branchId}`);
      }

      // If user has linked branches, join those too
      const cacheKey = `user:branches:${context.id}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        JSON.parse(cached).forEach(bid => rooms.add(`room:admin:branch:${bid}`));
      }
    }

    // Case 2: Context is an Event (e.g. order.created)
    if (context.orderId || context.branchId) {
      if (context.branchId) {
        rooms.add(`room:admin:branch:${context.branchId}`);
      }
      if (context.userId) {
        rooms.add(`room:user:${context.userId}`);
      }
    }

    return Array.from(rooms);
  }

  /**
   * 🛡️ Real-Time Audit: Validates user status (Active/Blacklisted) 
   * against the DB in real-time.
   */
  static async checkUserStatus(userId) {
    if (!userId) return { isActive: false, isBlacklisted: true };

    const prisma = require('../lib/prisma'); // 🛡️ Local require to break circular dependency

    // Fetch from DB (Check both User and Customer tables)
    let identity = await prisma.user.findUnique({
      where: { uuid: userId },
      select: { isActive: true } // 🛡️ User model doesn't have isBlacklisted
    });

    if (!identity) {
      identity = await prisma.customer.findUnique({
        where: { uuid: userId },
        select: { isDeleted: true, isBlacklisted: true } // 🛡️ Customer has isDeleted, not isActive
      });
    }

    if (!identity) {
      return { isActive: false, isBlacklisted: true };
    }

    const status = {
      isActive: identity.isActive !== false && identity.isDeleted !== true,
      isBlacklisted: identity.isBlacklisted === true
    };

    return status;
  }
  /**
   * 🏥 Rehydration System (Cold Start Safety)
   * Pre-loads security permissions into Redis for all active administrative users.
   */
  static async warmupSecurityCache() {
    const prisma = require('../lib/prisma');
    try {
      const activeUsers = await prisma.user.findMany({
        where: { 
          isActive: true,
          role: { in: ['admin', 'branch_manager', 'manager', 'super_admin'] }
        },
        select: { id: true, role: true, branchId: true }
      });

      logger.info(`[SecurityPolicy] 🛡️ Starting Security Cache Rehydration for ${activeUsers.length} users...`);

      for (const user of activeUsers) {
        // Calling getHardenedFilter triggers the internal caching logic
        await this.getHardenedFilter(user, 'Order').catch(() => {});
      }

      logger.info('[SecurityPolicy] ✅ Security Cache Rehydrated successfully.');
    } catch (err) {
      logger.error('[SecurityPolicy] ❌ Rehydration Failed', { error: err.message });
    }
  }

  /**
   * 🛡️ Invalidate User Permissions Cache
   * Purges the Redis cache and notifies the user's socket to refresh.
   */
  static async invalidateUserPermissions(userId) {
    const cacheKey = `user:branches:${userId}`;
    await redis.del(cacheKey);
    logger.warn('[SECURITY] Permissions invalidated', { userId, timestamp: Date.now() });

    // 📡 Notify Socket Layer to force sync
    try {
      const io = require('../socket').getIO();
      if (io) {
        io.to(`room:user:${userId}`).emit('permissions:updated', { 
          reason: 'AUTHORIZATION_CHANGE',
          timestamp: Date.now() 
        });
      }
    } catch (err) {
      logger.error('[SecurityPolicy] Failed to emit socket notification for invalidation', { userId });
    }
  }
}

module.exports = SecurityPolicyService;
