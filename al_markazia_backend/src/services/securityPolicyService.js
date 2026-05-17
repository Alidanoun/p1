/**
 * 🛡️ Security Policy Service (The Fortress)
 * The single source of truth for all authorization and data isolation logic.
 */
const NodeCache = require('node-cache');
const { BRANCH_ISOLATED_MODELS } = require('../config/branchIsolation');
const localBranchCache = new NodeCache({ stdTTL: 30, maxKeys: 1000 });
const inFlightBranches = new Map();

class SecurityPolicyService {
  constructor({ prisma, redis, logger }) {
    this.prisma = prisma;
    this.redis = redis;
    this.logger = logger;
  }

  /**
   * Generates a hardened filter for database queries based on user context.
   */
  async getHardenedFilter(user, modelName = 'Generic') {
    const logger = this.logger;
    const redis = this.redis;
    if (!user) throw new Error('UNAUTHORIZED: No security context provided');

    // 🛡️ [PHASE 2] Context Integrity Validation
    if (!user.id || !user.role) {
      logger.security('INVALID_SECURITY_CONTEXT', { user, modelName });
      throw new Error('INVALID_SECURITY_CONTEXT');
    }

    let normalizedRole = user.role.toLowerCase();
    
    const ALLOWED_ROLES = ['admin', 'branch_manager', 'manager', 'customer', 'staff', 'driver'];

    if (!ALLOWED_ROLES.includes(normalizedRole)) {
      logger.security('UNAUTHORIZED_ROLE_ACCESS', { userId: user.id, role: user.role, modelName });
      throw new Error('INVALID_USER_ROLE');
    }

    /**
     * 📊 ADMIN_SCOPE_MATRIX (Explicit Permissions)
     * Defines exactly what each administrative role can do.
     */
    const SCOPE_MATRIX = {
      admin: { canReadAll: true, canModifyAll: true }, // Global Admin with full access
      branch_manager: { canReadAll: false, canModifyAll: false },
      manager: { canReadAll: false, canModifyAll: false }
    };

    const scope = SCOPE_MATRIX[normalizedRole] || { canReadAll: false, canModifyAll: false };

    // 👑 Super Admin & Global Admins (Read Bypass)
    // If user has canReadAll and hasn't requested a specific branch, they see everything
    if (scope.canReadAll && !user.requestedBranchId) {
      const modelsWithSoftDelete = ['Order', 'Item', 'Category', 'Customer'];
      const filter = modelsWithSoftDelete.includes(modelName) ? { isDeleted: false } : {};
      return filter;
    }

    // 👑 Specific Branch Request for Super Admin / Global Admin
    if (scope.canReadAll) {
      const modelsWithSoftDelete = ['Order', 'Item', 'Category', 'Customer'];
      const filter = modelsWithSoftDelete.includes(modelName) ? { isDeleted: false } : {};
      
      // 🛡️ Apply manual branch isolation if requested
      if (user.requestedBranchId && BRANCH_ISOLATED_MODELS.has(modelName)) {
        filter.branchId = user.requestedBranchId;
      } else if (user.requestedBranchId && modelName === 'Branch') {
        filter.id = user.requestedBranchId;
      }
      
      return filter;
    }

    // 🎯 Model-Aware Field Selection (Initialize filter)
    const filter = {};

    // 🔗 [PHASE 3] Authoritative Branch Context (Zero Trust)
    // Automatically inject the branch context resolved by BranchAccessMiddleware
    const { getBranchId } = require('../utils/context');
    const authoritativeBranchId = getBranchId();
    
    if (authoritativeBranchId && normalizedRole !== 'admin') {
      if (BRANCH_ISOLATED_MODELS.has(modelName)) {
        filter.branchId = authoritativeBranchId;
      } else if (modelName === 'Branch') {
        filter.id = authoritativeBranchId;
      }
    }

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

    if (normalizedRole === 'admin') {
      return filter;
    }

    let allowedBranchIds = [];

    // 🏢 Admin / Manager: Access to assigned branch + any sub-branches
    if (['admin', 'branch_manager', 'manager'].includes(normalizedRole)) {
      if (user.branchId) allowedBranchIds.push(user.branchId);

      const cacheKey = `user:branches:${user.id}`;
      let extraIds = localBranchCache.get(cacheKey);

      if (!extraIds) {
        let cachedRedis = null;
        let redisDown = false;
        try {
          cachedRedis = await redis.get(cacheKey);
        } catch (e) {
          redisDown = true;
          logger.warn('[SecurityPolicy] Redis read failed, falling back to direct database linked branches lookup');
        }

        if (cachedRedis) {
          extraIds = JSON.parse(cachedRedis);
          localBranchCache.set(cacheKey, extraIds);
        } else {
          if (inFlightBranches.has(cacheKey)) {
            extraIds = await inFlightBranches.get(cacheKey);
          } else {
            const prisma = this.prisma;
            const fetchPromise = (async () => {
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
                const extra = linkedBranches.map(lb => lb.branchId);
                if (!redisDown) {
                  await redis.setex(cacheKey, 300, JSON.stringify(extra)).catch(() => {});
                }
                localBranchCache.set(cacheKey, extra);
                return extra;
              } else {
                logger.security('IDENTITY_RESOLUTION_FAILED', { userId: user.id, role: user.role });
                return [];
              }
            })();
            inFlightBranches.set(cacheKey, fetchPromise);
            extraIds = await fetchPromise;
            inFlightBranches.delete(cacheKey);
          }
        }
      }
      allowedBranchIds = [...new Set([...allowedBranchIds, ...extraIds])];
    } else {
      if (user.branchId) allowedBranchIds.push(user.branchId);
    }
    
    // 🛡️ [PHASE 4] Dynamic Branch Filtering
    let targetBranchIds = allowedBranchIds;

    // If a specific branch was requested, we must validate it against allowed list
    if (user.requestedBranchId) {
      if (normalizedRole === 'admin' || allowedBranchIds.includes(user.requestedBranchId)) {
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
    if (BRANCH_ISOLATED_MODELS.has(modelName)) {
      filter.branchId = { in: targetBranchIds };
    } else if (modelName === 'Branch') {
      filter.id = { in: targetBranchIds };
    }

    return filter;
  }

  /**
   * 🔒 High-Level Authorization: Checks if a user is allowed to access a branch.
   */
  async canAccessBranch(user, branchId, intent = 'write') {
    if (!user) return false;
    const role = user.role?.toLowerCase();

    // 📊 Define Scope Matrix (Internal copy for lookup)
    const SCOPE_MATRIX = {
      admin: { canReadAll: true, canModifyAll: true },
      branch_manager: { canReadAll: false, canModifyAll: false },
      manager: { canReadAll: false, canModifyAll: false }
    };

    const scope = SCOPE_MATRIX[role] || { canReadAll: false, canModifyAll: false };

    // 👑 Super Admin bypass
    if (role === 'admin') return true;

    // 👁️ READ INTENT: Global Admins can see everything
    if (intent === 'read' && scope.canReadAll) return true;

    // ✍️ WRITE INTENT: Global Admins must still have assigned branches to modify
    if (intent === 'write' && scope.canModifyAll) return true;

    // 🎯 Resolve explicitly allowed branches for this user
    const filter = await this.getHardenedFilter(user, 'Branch');
    const allowedIds = filter.id?.in || [];

    if (branchId === null || branchId === undefined) {
      // If order has no branch, only global managers/admins can access it
      return role === 'admin';
    }

    if (allowedIds.includes(branchId)) return true;

    this.logger.security('UNAUTHORIZED_BRANCH_ACCESS_DENIED', { 
      userId: user.id, 
      branchId, 
      role, 
      intent 
    });
    return false;
  }

  /**
   * 🎯 Get Maximum Intent Level for a User
   */
  getMaxIntent(user) {
    if (!user) return 'read';
    const role = user.role?.toLowerCase();
    
    // Admin: Full write everywhere
    if (role === 'admin') return 'write';
    
    // Branch Manager / Manager: Write within their branch scope
    if (['branch_manager', 'manager'].includes(role)) return 'write';
    
    // Customer: Read-only (order creation is handled separately)
    return 'read';
  }

  /**
   * Identifies target Socket.IO rooms for a user or an event.
   */
  async getTargetRooms(context) {
    const redis = this.redis;
    const { SOCKET_ROOMS } = require('../shared/socketEvents');
    const rooms = new Set();

    // Case 1: Context is a User (for joining rooms on connect)
    if (context.id && context.role) {
      rooms.add(SOCKET_ROOMS.CUSTOMER(context.id));

      let role = context.role.toLowerCase();

      // 👁️ MONITORING LAYER: Admins join the global monitoring room
      if (role === 'admin') {
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

        // Handle multi-branch managers safely
        const cacheKey = `user:branches:${context.id}`;
        let cached = null;
        try {
          cached = await redis.get(cacheKey);
        } catch (err) {
          this.logger.warn('[SecurityPolicy] Redis lookup failed in getTargetRooms', { error: err.message });
        }
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
   */
  wrapPayload(data) {
    const { v4: uuidv4 } = require('uuid');
    return {
      eventId: uuidv4(),
      timestamp: Date.now(),
      data
    };
  }

  /**
   * 🛡️ Real-Time Audit: Validates user status (Active/Blacklisted) 
   */
  async checkUserStatus(userId) {
    const prisma = this.prisma;
    if (!userId) return { isActive: false, isBlacklisted: true };

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
   */
  async warmupSecurityCache() {
    const prisma = this.prisma;
    const logger = this.logger;
    try {
      const activeUsers = await prisma.user.findMany({
        where: { 
          isActive: true,
          role: { in: ['admin', 'branch_manager', 'manager'] }
        },
        select: { id: true, role: true, branchId: true }
      });

      logger.info(`[SecurityPolicy] 🛡️ Starting Security Cache Rehydration for ${activeUsers.length} users...`);

      const warmupPromises = activeUsers.map(user => 
        this.getHardenedFilter(user, 'Order').catch(() => {})
      );
      await Promise.all(warmupPromises);

      logger.info('[SecurityPolicy] ✅ Security Cache Rehydrated successfully.');
    } catch (err) {
      logger.error('[SecurityPolicy] ❌ Rehydration Failed', { error: err.message });
    }
  }

  /**
   * 🛡️ Invalidate User Permissions Cache (Distributed Version)
   * This is the authoritative way to revoke or update user access.
   */
  async invalidateUserPermissions(userId) {
    const redis = this.redis;
    const prisma = this.prisma;
    const logger = this.logger;
    const container = getContainer();

    logger.warn('[SECURITY] Initializing Distributed Permission Invalidation', { userId });

    try {
      // ✅ Step 1: Wrap DB Update & Outbox event in same transaction
      const result = await prisma.$transaction(async (tx) => {
        // A. 🏛️ Authority Update: Increment Version in DB
        let updatedUser = await tx.user.update({
          where: { uuid: userId },
          data: { permissionVersion: { increment: 1 } },
          select: { id: true, role: true }
        }).catch(() => null);

        if (!updatedUser) {
          // Try customer table if user not found
          await tx.customer.update({
            where: { uuid: userId },
            data: { permissionVersion: { increment: 1 } }
          }).catch(() => null);
        }

        // B. 🛰️ Enqueue outbox event atomically
        const outboxEvent = await container.outboxService.enqueue(tx, {
          type: 'USER_PERMISSIONS_CHANGED',
          aggregateId: String(userId),
          aggregateType: 'User',
          payload: { userId, reason: 'ADMIN_ACTION' },
          version: 1,
          eventSequence: 1,
          metadata: {
            createdAt: new Date(),
            source: 'securityPolicyService.invalidate'
          }
        });

        return { outboxId: outboxEvent.id };
      });

      // ✅ Step 1.5: Add active sessions of user to blacklist for instant revocation
      try {
        const tokenBlacklistService = require('./tokenBlacklistService');
        await tokenBlacklistService.blacklistUserSessions(userId, 'ADMIN_REVOKED');
      } catch (blacklistErr) {
        logger.warn('[SecurityPolicy] Token session blacklisting failed', { error: blacklistErr.message });
      }

      // ✅ Step 2: Clear local cache (Safe side effect)
      const cacheKey = `user:branches:${userId}`;
      try {
        localBranchCache.del(cacheKey);
        await redis.del(cacheKey);
      } catch (cacheErr) {
        logger.warn('[SecurityPolicy] Cache invalidation failed (non-critical optimization drop)', { error: cacheErr.message });
      }

      // ✅ Step 3: Trigger Outbox Pulse & Immediate Dispatch
      if (result?.outboxId) {
        await container.outboxService.immediateDispatch(result.outboxId).catch(() => {});
      }
      setImmediate(() => {
        container.outboxService?.pulse?.().catch(() => {});
      });

      logger.info('[SECURITY] Distributed Invalidation Dispatch Success', { userId });
      return true;
    } catch (err) {
      logger.error('[SECURITY] Critical: Distributed Invalidation Failed', { userId, error: err.message });
      return false;
    }
  }
}

// --- 🛡️ Backward Compatibility Layer (Static Proxies) ---
// These ensure existing code doesn't break while we migrate.
const getContainer = () => require('../lib/container');

SecurityPolicyService.getHardenedFilter = (user, modelName) => 
  getContainer().securityPolicyService.getHardenedFilter(user, modelName);

SecurityPolicyService.canAccessBranch = (user, branchId, intent) => 
  getContainer().securityPolicyService.canAccessBranch(user, branchId, intent);

SecurityPolicyService.getMaxIntent = (user) => 
  getContainer().securityPolicyService.getMaxIntent(user);

SecurityPolicyService.getTargetRooms = (context) => 
  getContainer().securityPolicyService.getTargetRooms(context);

SecurityPolicyService.wrapPayload = (data) => 
  getContainer().securityPolicyService.wrapPayload(data);

SecurityPolicyService.checkUserStatus = (userId) => 
  getContainer().securityPolicyService.checkUserStatus(userId);

SecurityPolicyService.warmupSecurityCache = () => 
  getContainer().securityPolicyService.warmupSecurityCache();

SecurityPolicyService.invalidateUserPermissions = (userId) => 
  getContainer().securityPolicyService.invalidateUserPermissions(userId);

module.exports = SecurityPolicyService;
module.exports.SecurityPolicyService = SecurityPolicyService;
