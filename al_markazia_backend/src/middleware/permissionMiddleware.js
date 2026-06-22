const prisma = require('../lib/prisma');
const redis = require('../lib/redis');
const bcrypt = require('bcrypt');
const logger = require('../utils/logger');

/**
 * 🔐 Advanced Branch Permission Middleware
 * Enforces dynamic access levels (NONE, VIEW, EDIT_PIN, FULL) per branch.
 * Includes Redis caching for permissions, PIN session caching, and PIN Rate Limiting.
 */
const checkPermission = (module, requiredLevel = 'VIEW') => {
  const checkPermissionMiddleware = async (req, res, next) => {
    try {
      // 1. Admin bypass: Global Admin has absolute access
      if (req.user?.role?.toUpperCase() === 'ADMIN') return next();

      const branchId = req.user?.branchId;
      if (!branchId) {
        return res.status(403).json({ error: 'لم يتم العثور على فرع مرتبط بهذا الحساب' });
      }

      // 2. Fetch permissions from Redis Cache or DB
      const cacheKey = `branch:${branchId}:permissions_matrix`;
      let permissions = null;
      try {
        const cachedRedis = await redis.get(cacheKey);
        if (cachedRedis) {
          permissions = JSON.parse(cachedRedis);
        }
      } catch (e) {
        logger.warn('[checkPermission] Redis read failed', { error: e.message });
      }

      if (!permissions) {
        permissions = await prisma.branchPermissions.findUnique({
          where: { branchId }
        });

        if (permissions) {
          try {
            await redis.setex(cacheKey, 3600, JSON.stringify(permissions));
          } catch (e) {
            logger.warn('[checkPermission] Redis write failed', { error: e.message });
          }
        }
      }

      // Safe fallback if permissions record is missing
      if (!permissions) {
        logger.warn(`No permissions found for branch ${branchId}, using safe defaults.`);
        permissions = {
          liveOrders: 'FULL',
          manageOrders: 'FULL',
          menu: 'VIEW',
          notifications: 'VIEW',
          reviews: 'VIEW',
          loyalty: 'VIEW',
          rewardsStore: 'NONE',
          advancedAnalytics: 'NONE',
          financials: 'NONE',
          deliveryZones: 'VIEW',
          auditLog: 'NONE',
          settings: 'VIEW',
          canModifyWorkHours: 'VIEW'
        };
      }

      const modulePermission = permissions[module] || 'NONE';

      // 3. NONE level: Completely hidden & blocked
      if (modulePermission === 'NONE') {
        return res.status(403).json({
          error: 'غير مصرح لك بالوصول إلى هذه الوحدة',
          code: 'ACCESS_DENIED'
        });
      }

      // 4. VIEW level: Allowed for GET, blocked for state-changing write operations
      const isWriteOperation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
      if (modulePermission === 'VIEW' && isWriteOperation) {
        return res.status(403).json({
          error: 'هذا القسم متاح للمشاهدة فقط، لا يمكن إجراء أي تعديلات',
          code: 'VIEW_ONLY'
        });
      }

      const crypto = require('crypto');
      const fingerprint = crypto.createHash('sha256')
        .update(`${req.user.id}:${req.ip || req.headers['x-forwarded-for'] || 'unknown'}:${req.headers['user-agent'] || 'no-ua'}`)
        .digest('hex');
      const pinCacheKey = `branch:${branchId}:user:${req.user.id}:fp:${fingerprint}:manager_pin_verified`;

      // Helper to check cache validity, count uses, and audit log bypasses
      const checkCacheAndIncrement = async () => {
        const cachedVal = await redis.get(pinCacheKey).catch(() => null);
        if (cachedVal) {
          const count = parseInt(cachedVal, 10);
          if (count < 3) {
            await redis.incr(pinCacheKey).catch(() => {});
            
            // Log to SystemAuditLog
            const auditService = require('../services/auditService');
            await auditService.log({
              userId: req.user.id,
              userRole: req.user.role,
              action: 'PIN_CACHE_BYPASS',
              entityType: 'Branch',
              entityId: branchId.toString(),
              status: 'SUCCESS',
              metadata: {
                module,
                requiredLevel,
                consecutiveBypasses: count + 1,
                ip: req.ip || req.headers['x-forwarded-for'] || 'unknown'
              },
              req
            }).catch(err => logger.error('Failed to log PIN cache bypass audit', { error: err.message }));

            return true;
          }
        }
        return false;
      };

      // 5. EDIT_PIN_READ level: Requires PIN verification even for GET (read) operations
      if (modulePermission === 'EDIT_PIN_READ' && !isWriteOperation) {
        const isVerifiedInCache = await checkCacheAndIncrement();
        if (!isVerifiedInCache) {
          return res.status(401).json({
            error: 'يتطلب عرض هذا القسم إدخال رقم PIN الخاص بالمدير',
            code: 'PIN_REQUIRED_TO_VIEW'
          });
        }
      }

      // 6. EDIT_PIN & EDIT_PIN_READ levels: Requires PIN validation for write operations
      if ((modulePermission === 'EDIT_PIN' || modulePermission === 'EDIT_PIN_READ') && isWriteOperation) {
        const { managerPin } = req.body;

        const isVerifiedInCache = await checkCacheAndIncrement();

        if (!isVerifiedInCache) {
          if (!managerPin) {
            return res.status(401).json({
              error: 'يتطلب هذا الإجراء رقم PIN الخاص بالمدير لتأكيده',
              code: 'PIN_REQUIRED'
            });
          }

          // Rate Limiter for PIN Attempts (Max 5 attempts in 15 mins)
          const rateLimitKey = `pin:attempts:${branchId}`;
          const attempts = await redis.incr(rateLimitKey).catch(() => 0);
          if (attempts === 1) {
            await redis.expire(rateLimitKey, 900).catch(() => {}); // 15 mins expiry
          }

          if (attempts > 5) {
            return res.status(429).json({
              error: 'تم تجاوز عدد محاولات الـ PIN المسموحة، حاول مجدداً بعد 15 دقيقة',
              code: 'PIN_LOCKED'
            });
          }

          const manager = await prisma.user.findFirst({
            where: {
              branchId,
              role: 'BRANCH_MANAGER',
              isActive: true
            }
          });

          if (!manager || !manager.pinHash) {
            return res.status(400).json({ error: 'لم يتم تعيين رقم PIN لمدير هذا الفرع بعد' });
          }

          const isPinValid = await bcrypt.compare(managerPin, manager.pinHash);
          if (!isPinValid) {
            return res.status(401).json({
              error: 'رقم PIN غير صحيح',
              code: 'INVALID_PIN'
            });
          }

          // Reset rate limits on success
          await redis.del(rateLimitKey).catch(() => {});

          // Cache success verified state for 90 seconds (count = 0 initially since this first action was WITH pin)
          await redis.setex(pinCacheKey, 90, '0').catch(() => {});
        }
      }

      next();
    } catch (error) {
      logger.error('Error in permission middleware', { error: error.message });
      res.status(500).json({ error: 'حدث خطأ داخلي أثناء التحقق من الصلاحيات' });
    }
  };

  checkPermissionMiddleware.metadata = {
    isCheckPermission: true,
    module,
    requiredLevel
  };

  return checkPermissionMiddleware;
};

module.exports = { checkPermission };
