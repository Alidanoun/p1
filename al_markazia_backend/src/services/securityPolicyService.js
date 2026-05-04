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

    // 👑 Super Admin: Absolute Visibility with optional branch isolation
    if (normalizedRole === 'super_admin') {
      const modelsWithSoftDelete = ['Order', 'Item', 'Category', 'Customer'];
      const filter = modelsWithSoftDelete.includes(modelName) ? { isDeleted: false } : {};
      
      // 🛡️ Apply manual branch isolation if requested
      if (user.requestedBranchId && ['Order', 'BranchItem', 'FinancialLedger', 'DailyFinancialSnapshot'].includes(modelName)) {
        filter.branchId = user.requestedBranchId;
      } else if (user.requestedBranchId && modelName === 'Branch') {
        filter.id = user.requestedBranchId;
      }
      
      return filter;
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
    
    // 🛡️ [PHASE 4] Dynamic Branch Filtering
    let targetBranchIds = allowedBranchIds;

    // If a specific branch was requested, we must validate it against allowed list
    if (user.requestedBranchId) {
      if (allowedBranchIds.includes(user.requestedBranchId)) {
        targetBranchIds = [user.requestedBranchId];
      } else {
        logger.security('UNAUTHORIZED_BRANCH_REQUEST', { 
          userId: user.id, 
          requestedBranchId: user.requestedBranchId, 
          allowed: allowedBranchIds 
        });
        // Fail-safe: Return no results if requesting unauthorized branch
        return { id: { in: [] }, ...filter };
      }
    }

    // Apply branch filters based on model type
    const branchIsolationModels = ['Order', 'BranchItem', 'FinancialLedger', 'DailyFinancialSnapshot'];
    if (branchIsolationModels.includes(modelName)) {
      filter.branchId = { in: targetBranchIds };
    } else if (modelName === 'Branch') {
      filter.id = { in: targetBranchIds };
    }

    return filter;
  }

  /**
   * 🔒 High-Level Authorization: Checks if a user is allowed to access a branch.
   */
  static async canAccessBranch(user, branchId) {
    if (!user) return false;
    const role = user.role?.toLowerCase();

    // 👑 Super Admin bypass
    if (role === 'super_admin') return true;

    // 🌐 Global Admin bypass: If an admin doesn't have a restricted branch, they can access any.
    if (role === 'admin' && !user.branchId) return true;

    // 🎯 Resolve allowed branches for this user
    const filter = await this.getHardenedFilter(user, 'Branch');
    const allowedIds = filter.id?.in || [];

    if (branchId === null || branchId === undefined) {
      // If order has no branch, only global admins/superadmins can access it
      return role === 'admin' || role === 'super_admin';
    }

    if (allowedIds.includes(branchId)) return true;

    logger.security('UNAUTHORIZED_BRANCH_ACCESS_DENIED', { userId: user.id, branchId, role });
    return false;
  }

  /**
   * Identifies target Socket.IO rooms for a user or an event.
   * @param {Object} context - User object or Event metadata.
   * @returns {Promise<string[]>} List of room identifiers.
   */
  static async getTargetRooms(context) {
    const { SOCKET_ROOMS } = require('../shared/socketEvents');
    const rooms = new Set();

    // Case 1: Context is a User (for joining rooms on connect)
    if (context.id && context.role) {
      rooms.add(SOCKET_ROOMS.CUSTOMER(context.id));

      const role = context.role.toLowerCase();

      // 👁️ MONITORING LAYER: Admins join the global monitoring room
      if (['super_admin', 'admin'].includes(role)) {
        rooms.add(SOCKET_ROOMS.MONITOR_GLOBAL);
        
        // If they have a preferred branch, they can also monitor its specific room
        if (context.branchId) {
          rooms.add(SOCKET_ROOMS.MONITOR_BRANCH(context.branchId));
        }
      }

      // 🛠️ EXECUTION LAYER: Managers/Branch Managers join the execution room of their branch
      if (['branch_manager', 'manager'].includes(role)) {
        if (context.branchId) {
          rooms.add(SOCKET_ROOMS.EXEC_BRANCH(context.branchId));
        }

        // Handle multi-branch managers
        const cacheKey = `user:branches:${context.id}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
          JSON.parse(cached).forEach(bid => rooms.add(SOCKET_ROOMS.EXEC_BRANCH(bid)));
        }
      }
    }

    // Case 2: Context is an Event (e.g. order.created)
    if (context.orderId || context.branchId) {
      // 🛠️ Execution: Route to the specific branch execution room
      if (context.branchId) {
        rooms.add(SOCKET_ROOMS.EXEC_BRANCH(context.branchId));
      }

      // 👁️ Monitoring: Always route to the global monitoring room for admins
      rooms.add(SOCKET_ROOMS.MONITOR_GLOBAL);
      
      // If specific branch monitoring is needed
      if (context.branchId) {
        rooms.add(SOCKET_ROOMS.MONITOR_BRANCH(context.branchId));
      }

      // 👤 Customer: Private boundary
      if (context.userId || context.customerUuid) {
        rooms.add(SOCKET_ROOMS.CUSTOMER(context.userId || context.customerUuid));
      }
    }

    return Array.from(rooms);
  }

  /**
   * 🏷️ Standardized Event Wrapper
   * Wraps the payload with metadata including a unique eventId for frontend deduplication.
   */
  static wrapPayload(data) {
    const { v4: uuidv4 } = require('uuid');
    return {
      eventId: uuidv4(),
      timestamp: Date.now(),
      data
    };
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
   * Purges the Redis cache and forces active sockets to re-calculate their room boundaries.
   */
  static async invalidateUserPermissions(userId) {
    const cacheKey = `user:branches:${userId}`;
    await redis.del(cacheKey);
    logger.warn('[SECURITY] Permissions invalidated', { userId, timestamp: Date.now() });

    // 📡 Active Boundary Re-sync
    try {
      const io = require('../socket').getIO();
      const { SOCKET_ROOMS } = require('../shared/socketEvents');
      if (!io) return;

      const userRoom = SOCKET_ROOMS.CUSTOMER(userId);
      const sockets = await io.in(userRoom).fetchSockets();

      for (const socket of sockets) {
        logger.info(`[SecurityPolicy] Force-syncing rooms for socket ${socket.id} (User: ${userId})`);
        
        // 1. Refresh socket user context (to avoid stale role/branchId)
        const prisma = require('../lib/prisma');
        const freshUser = await prisma.user.findUnique({
          where: { uuid: userId },
          select: { id: true, role: true, branchId: true }
        });

        if (freshUser) {
          socket.user = { 
            ...socket.user, 
            role: freshUser.role.toLowerCase(), 
            branchId: freshUser.branchId 
          };
        }

        // 2. Leave all sensitive rooms
        const currentRooms = Array.from(socket.rooms);
        for (const room of currentRooms) {
          if (room.startsWith('room:exec:') || room.startsWith('room:monitor:')) {
            socket.leave(room);
          }
        }

        // 3. Re-calculate and Join new rooms
        const newRooms = await this.getTargetRooms(socket.user);
        newRooms.forEach(room => socket.join(room));

        // 4. Notify client of the sync
        socket.emit('permissions:synced', { 
          timestamp: Date.now(),
          rooms: newRooms.filter(r => !r.startsWith('room:user:')) 
        });
      }
    } catch (err) {
      logger.error('[SecurityPolicy] Failed to force-sync socket rooms', { userId, error: err.message });
    }
  }
}

module.exports = SecurityPolicyService;
