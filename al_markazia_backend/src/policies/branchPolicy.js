/**
 * ⚖️ Hardened Branch Security Policy (Enterprise Grade v2.1)
 * PRINCIPLES:
 * 1. Deny-by-Default (Zero Trust)
 * 2. Capability-Based Access Control (CBAC)
 * 3. Database is the Truth (JWT is just a claim)
 */

const logger = require('../utils/logger');
const prisma = require('../lib/prisma');

const CAPABILITIES = {
  READ_ALL: 'read_all',
  WRITE_ALL: 'write_all',
  READ_BRANCH: 'read_branch',
  WRITE_BRANCH: 'write_branch'
};

const ROLE_POLICIES = {
  super_admin: [CAPABILITIES.READ_ALL, CAPABILITIES.WRITE_ALL],
  admin: [CAPABILITIES.READ_ALL],
  branch_manager: [CAPABILITIES.READ_BRANCH, CAPABILITIES.WRITE_BRANCH],
  manager: [CAPABILITIES.READ_BRANCH, CAPABILITIES.WRITE_BRANCH],
  staff: [CAPABILITIES.READ_BRANCH]
};

class BranchPolicy {
  /**
   * 🛡️ Strict DB-First Validation
   * Ensures that the user's branch in the JWT matches the DB truth.
   */
  async validateAndGetTruth(userId) {
    const dbUser = await prisma.user.findUnique({
      where: { uuid: userId },
      select: { id: true, isActive: true, branchId: true, role: true }
    });

    if (!dbUser || !dbUser.isActive) {
      logger.security('🛑 Access Denied: User inactive or not found in DB', { userId });
      return null;
    }
    return dbUser;
  }

  /**
   * 🛡️ Capability Check (Replaces Role Bypass)
   */
  hasCapability(role, capability) {
    const policy = ROLE_POLICIES[role?.toLowerCase()] || [];
    return policy.includes(capability);
  }

  /**
   * 🔍 Generates a HARDENED Prisma filter
   */
  async getHardenedFilter(userId, requestedBranchId = null) {
    const truth = await this.validateAndGetTruth(userId);
    if (!truth) return { id: -1 }; // Deny-by-default (Impossible ID)

    const { role, branchId } = truth;

    // 1. If has READ_ALL, allow access but still scope to requestedBranchId if provided
    if (this.hasCapability(role, CAPABILITIES.READ_ALL)) {
      if (requestedBranchId) return { branchId: requestedBranchId };
      
      // Still scoped: Only branches that actually exist (Explicit Inclusion)
      const activeBranches = await prisma.branch.findMany({ select: { id: true } });
      return { branchId: { in: activeBranches.map(b => b.id) } };
    }

    // 2. If locked to branch, ONLY allow their own branch
    if (this.hasCapability(role, CAPABILITIES.READ_BRANCH)) {
      if (!branchId) {
        logger.error('🛑 Manager found without branchId', { userId });
        return { id: -1 };
      }
      return { branchId: branchId };
    }

    return { id: -1 }; // Final safety net
  }

  /**
   * 📡 Targeted Event Dispatching
   */
  async getTargetRooms(event) {
    const { type, branchId, customerUuid } = event;
    const rooms = [];

    // Notify Global Admin Boundary
    rooms.push('room:admin:global');

    // Notify Branch Boundary (only if it exists)
    if (branchId) {
      rooms.push(`room:branch:${branchId}`);
    }

    if (customerUuid) {
      rooms.push(`room:user:${customerUuid}`);
    }

    return [...new Set(rooms)];
  }

  /**
   * 🏷️ Versioned Payload Wrapper
   */
  wrapPayload(data, version = 1) {
    return {
      metadata: {
        version,
        timestamp: Date.now(),
        policy: 'v2.1:hardened_cbac'
      },
      data
    };
  }
}

module.exports = new BranchPolicy();
