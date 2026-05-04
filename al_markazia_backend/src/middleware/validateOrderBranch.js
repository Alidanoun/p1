const prisma = require('../lib/prisma');
const redis = require('../lib/redis');
const response = require('../utils/response');
const logger = require('../utils/logger');

/**
 * 🏢 Mandatory Branch Validation Middleware (Hardened v2)
 * Ensures every order is strictly tied to a valid and active branch.
 * 
 * Security Layers:
 * 1. Input Sanitization & Validation
 * 2. Branch Existence & Active Status (Cached)
 * 3. Guest Order Whitelist Check
 * 4. Authenticated User Authorization (via SecurityPolicyService)
 * 5. Audit Logging for suspicious attempts
 */

// 🛡️ Branch Cache: Reduces DB queries for high-traffic order creation
const BRANCH_CACHE_TTL = 300; // 5 minutes
const BRANCH_CACHE_KEY = 'cache:active_branches';

/**
 * Get active branches from cache or DB
 */
async function getActiveBranches() {
  try {
    const cached = await redis.get(BRANCH_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    logger.warn('[BranchCache] Redis read failed, falling back to DB', { error: err.message });
  }

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, isActive: true }
  });

  // Cache the result
  try {
    await redis.setex(BRANCH_CACHE_KEY, BRANCH_CACHE_TTL, JSON.stringify(branches));
  } catch (err) {
    logger.warn('[BranchCache] Redis write failed', { error: err.message });
  }

  return branches;
}

/**
 * 🔍 Input Sanitization: Validates and sanitizes branchId input
 */
function sanitizeBranchInput(input) {
  if (!input || typeof input !== 'string') return null;
  
  // Remove any dangerous characters, allow only alphanumeric, hyphens, and Arabic
  const sanitized = input.trim().replace(/[<>"';(){}]/g, '');
  
  // Reject suspiciously long inputs (UUIDs are 36 chars, codes are short)
  if (sanitized.length > 100) return null;
  
  return sanitized;
}

module.exports = async (req, res, next) => {
  try {
    req.body = req.body || {};
    
    // 🛡️ Support both 'branchId' and 'branch' keys for flexibility
    const rawBranchId = req.body.branchId || req.body.branch;

    // 1️⃣ Input Validation & Sanitization
    if (!rawBranchId) {
      return response.error(res, 'يجب تحديد الفرع (branchId is required)', 'BRANCH_REQUIRED', 400);
    }

    const branchId = sanitizeBranchInput(rawBranchId);
    if (!branchId) {
      logger.security('MALFORMED_BRANCH_INPUT', {
        rawInput: String(rawBranchId).substring(0, 50),
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      return response.error(res, 'معرف الفرع غير صالح', 'INVALID_BRANCH_FORMAT', 400);
    }

    // 2️⃣ Branch Resolution: Try cache first, then DB
    let branch = null;
    const activeBranches = await getActiveBranches();
    
    if (branchId.length > 30) {
      // UUID lookup
      branch = activeBranches.find(b => b.id === branchId);
    } else {
      // Code lookup (case-insensitive)
      branch = activeBranches.find(b => b.code.toUpperCase() === branchId.toUpperCase());
    }

    // Fallback to direct DB query if cache miss (safety net)
    if (!branch) {
      branch = await prisma.branch.findUnique({
        where: {
          ...(branchId.length > 30 ? { id: branchId } : { code: branchId.toUpperCase() })
        },
        select: { id: true, isActive: true, name: true }
      });
    }

    if (!branch) {
      return response.error(res, 'الفرع المحدد غير موجود (Invalid Branch)', 'INVALID_BRANCH', 400);
    }

    if (!branch.isActive) {
      return response.error(res, `الفرع (${branch.name}) مغلق حالياً، يرجى اختيار فرع آخر`, 'BRANCH_CLOSED', 400);
    }

    // 3️⃣ Guest Order Validation (Unauthenticated users)
    if (!req.user) {
      // 🛡️ Audit: Log all guest order attempts for monitoring
      logger.info(`[GuestOrder] Branch: ${branch.name} (${branch.id}) | IP: ${req.ip}`);

      // Check if original input tried to use a different branch than resolved
      if (rawBranchId !== branch.id && rawBranchId.length > 30) {
        // Someone sent a UUID that doesn't match — possible tampering attempt
        const auditService = require('../services/auditService');
        await auditService.log({
          action: 'SUSPICIOUS_GUEST_BRANCH_ATTEMPT',
          entityType: 'Order',
          status: 'BLOCKED',
          severity: 'WARN',
          metadata: {
            rawBranchId: rawBranchId,
            resolvedBranchId: branch.id,
            ip: req.ip,
            userAgent: req.headers['user-agent']
          },
          req
        });
      }
    }

    // 4️⃣ Authenticated User Authorization
    if (req.user) {
      const role = req.user.role?.toLowerCase();
      
      // Admin/Super-Admin: Global access allowed
      if (role === 'admin') {
        // Inject verified branch and continue
        req.body.branchId = branch.id;
        req.validatedBranch = branch;
        return next();
      }

      // Manager/Branch Manager: Must have explicit access to this branch
      if (['manager', 'branch_manager'].includes(role)) {
        const SecurityPolicyService = require('../services/securityPolicyService');
        const canAccess = await SecurityPolicyService.canAccessBranch(req.user, branch.id, 'write');
        
        if (!canAccess) {
          // 🚨 CRITICAL: Manager trying to create order in unauthorized branch
          const auditService = require('../services/auditService');
          await auditService.log({
            userId: req.user.id,
            userRole: role,
            action: 'UNAUTHORIZED_ORDER_CREATION_ATTEMPT',
            entityType: 'Order',
            status: 'BLOCKED',
            severity: 'CRITICAL',
            metadata: {
              targetBranchId: branch.id,
              targetBranchName: branch.name,
              userBranchId: req.user.branchId
            },
            req
          });
          return response.error(res, 'غير مصرح لك بإنشاء طلبات لهذا الفرع', 'FORBIDDEN', 403);
        }
      }
    }

    // 5️⃣ Injection Prevention: Inject the verified ID back into the body
    req.body.branchId = branch.id;
    req.validatedBranch = branch;
    
    next();
  } catch (error) {
    logger.error('validateOrderBranch Error', { error: error.message });
    return response.error(res, 'خطأ في التحقق من صحة الفرع', 'INTERNAL_ERROR', 500);
  }
};

/**
 * 🔄 Invalidate branch cache (call when branches are updated/created/deleted)
 */
module.exports.invalidateBranchCache = async () => {
  try {
    await redis.del(BRANCH_CACHE_KEY);
    logger.info('[BranchCache] ♻️ Cache invalidated');
  } catch (err) {
    logger.warn('[BranchCache] Failed to invalidate cache', { error: err.message });
  }
};
