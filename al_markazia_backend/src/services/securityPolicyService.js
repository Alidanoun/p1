const prisma = require('../lib/prisma');
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

    // 👑 Super Admin: Absolute Visibility (Bypass branch isolation)
    if (user.role === 'super_admin') {
      return { isDeleted: false }; 
    }

    let allowedBranchIds = [];

    // 🏢 Admin / Manager: Access to assigned branch + any sub-branches
    if (['admin', 'branch_manager', 'manager'].includes(user.role)) {
      if (user.branchId) allowedBranchIds.push(user.branchId);

      const cacheKey = `user:branches:${user.id}`;
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        const extraIds = JSON.parse(cached);
        allowedBranchIds = [...new Set([...allowedBranchIds, ...extraIds])];
      } else {
        const linkedBranches = await prisma.userBranch.findMany({
          where: { userId: user.id },
          select: { branchId: true }
        });
        const extraIds = linkedBranches.map(lb => lb.branchId);
        await redis.setex(cacheKey, 3600, JSON.stringify(extraIds));
        allowedBranchIds = [...new Set([...allowedBranchIds, ...extraIds])];
      }
    } 
    else {
      if (user.branchId) allowedBranchIds.push(user.branchId);
    }

    if (allowedBranchIds.length === 0 && user.role !== 'super_admin') {
      logger.warn('[SecurityPolicy] Blocked attempt: User has no branch context', { userId: user.id, role: user.role });
      return { id: 'BLOCK_ALL', isDeleted: false }; 
    }

    // 🎯 Model-Aware Field Selection
    // If we are querying the 'Branch' model itself, we filter by 'id'.
    // Otherwise, we filter by 'branchId'.
    const filterField = modelName === 'Branch' ? 'id' : 'branchId';

    return {
      [filterField]: allowedBranchIds.length === 1 ? allowedBranchIds[0] : { in: allowedBranchIds },
      isDeleted: false
    };
  }

  /**
   * Performs a high-speed status check for a user.
   * @param {string} userId - UUID of the user.
   * @returns {Promise<Object>} Status details { isActive, isBlacklisted }.
   */
  static async checkUserStatus(userId) {
    const cacheKey = `user:status:v1:${userId}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // Fetch from DB (Check both User and Customer tables)
    let identity = await prisma.user.findUnique({
      where: { uuid: userId },
      select: { isActive: true, isBlacklisted: true }
    });

    if (!identity) {
      identity = await prisma.customer.findUnique({
        where: { uuid: userId },
        select: { isActive: true, isBlacklisted: true }
      });
    }

    if (!identity) throw new Error('IDENTITY_NOT_FOUND');

    const status = {
      isActive: identity.isActive !== false,
      isBlacklisted: identity.isBlacklisted === true
    };

    // Cache for 5 minutes (Balance between speed and real-time accuracy)
    await redis.setex(cacheKey, 300, JSON.stringify(status));
    return status;
  }

  /**
   * Immediately invalidates security cache for a user (e.g. after password change or ban).
   */
  static async invalidateCache(userId) {
    await Promise.all([
      redis.del(`user:status:v1:${userId}`),
      redis.del(`user:branches:${userId}`)
    ]);
    logger.info(`[SecurityPolicy] Cache invalidated for user: ${userId}`);
  }
}

module.exports = SecurityPolicyService;
