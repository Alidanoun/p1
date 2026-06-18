'use strict';

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const prisma = require('../lib/prisma');
const redis = require('../lib/redis');
const NodeCache = require('node-cache');

const {
  JWT_PRIVATE_KEY: PRIVATE_KEY,
  JWT_PUBLIC_KEY: PUBLIC_KEY,
  REFRESH_TOKEN_SECRET,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY_MS
} = require('../config/secrets');

// ─────────────────────────────────────────────────────────────
// [FIX-4] maxKeys قابل للضبط عبر متغير بيئة + useClones: false
//         للأداء الأمثل (لا نحتاج نسخاً عميقة لكائنات الجلسة)
// ─────────────────────────────────────────────────────────────
const L1 = new NodeCache({
  stdTTL: 15,
  checkperiod: 30,
  maxKeys: parseInt(process.env.L1_CACHE_MAX_KEYS || '5000', 10),
  useClones: false
});

// Request Coalescing Map: دمج الاستعلامات المتزامنة لنفس الجلسة
const inFlightValidations = new Map();

// ─────────────────────────────────────────────────────────────
// [FIX-1] دالة مساعدة: تُلف أي Promise بحد زمني أقصى
//         إذا تجاوز الـ Promise المدة → يُرجع fallback بدلاً من التجمد
// ─────────────────────────────────────────────────────────────
function withTimeout(promise, ms, fallback) {
  const timer = new Promise(resolve =>
    setTimeout(() => resolve(fallback), ms)
  );
  return Promise.race([promise, timer]);
}

// ─────────────────────────────────────────────────────────────

class TokenService {

  // ═══════════════════════════════════════════════════════════
  // توليد Access Token
  // ═══════════════════════════════════════════════════════════
  static generateAccessToken(user, jti) {
    return jwt.sign(
      {
        id: user.uuid,
        role: user.role || 'customer',
        branchId: user.branchId || null,
        sid: jti,
        jti,
        av: user.authVersion || 1,
        pv: user.permissionVersion || 1,
        iat: Math.floor(Date.now() / 1000)
      },
      PRIVATE_KEY,
      { algorithm: 'RS256', expiresIn: ACCESS_TOKEN_EXPIRY }
    );
  }

  // ═══════════════════════════════════════════════════════════
  // توليد وحفظ Refresh Token (DB + Redis)
  // ═══════════════════════════════════════════════════════════
  static async generateAndSaveRefreshToken(user, context = {}) {
    const role = user.role || 'customer';
    const jti = uuidv4();
    const family = context.familyId || uuidv4();
    const userId = user.uuid;

    const token = jwt.sign(
      { id: userId, role, jti },
      REFRESH_TOKEN_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRY }
    );

    const sessionKey = `session:${userId}:${jti}`;

    const resolvedFingerprint =
      typeof context.fingerprint === 'object' && context.fingerprint !== null
        ? context.fingerprint.hash
        : (context.fingerprint || null);

    const sessionData = {
      sid: jti,
      uid: userId,
      role,
      branchId: user.branchId || null,
      av: user.authVersion || 1,
      pv: user.permissionVersion || 1,
      ip: context.ip || 'unknown',
      ua: context.userAgent || 'unknown',
      fingerprint: resolvedFingerprint,
      createdAt: new Date().toISOString()
    };

    const ttlSeconds = Math.floor(REFRESH_TOKEN_EXPIRY_MS / 1000);

    try {
      await Promise.race([
        Promise.all([
          redis.set(sessionKey, JSON.stringify(sessionData), 'EX', ttlSeconds),
          redis.sadd(`user_sessions:${userId}`, jti),
          redis.expire(`user_sessions:${userId}`, ttlSeconds)
        ]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('REDIS_TIMEOUT')), 500)
        )
      ]);
    } catch (err) {
      logger.warn(
        '[TokenService] Redis session registry skipped or timed out, relying on DB fallback',
        { userId, error: err.message }
      );
    }

    try {
      const tokenData = {
        token,
        role,
        jti,
        tokenFamily: family,
        fingerprint: resolvedFingerprint,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS)
      };

      tokenData.userId = user.uuid;

      await prisma.refreshToken.create({
        data: tokenData
      });
    } catch (dbErr) {
      logger.error(
        '[TokenService] DB token creation failed. Rolling back Redis session.',
        { error: dbErr.message, userId, jti }
      );
      await Promise.all([
        redis.del(sessionKey),
        redis.srem(`user_sessions:${userId}`, jti)
      ]).catch(rErr =>
        logger.error('[TokenService] Redis rollback failed', { error: rErr.message })
      );
      throw new Error('SESSION_CREATION_FAILED');
    }

    return { token, jti, family };
  }

  // ═══════════════════════════════════════════════════════════
  // التحقق من Access Token
  // ═══════════════════════════════════════════════════════════
  static verifyAccessToken(token) {
    try {
      return jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] });
    } catch (error) {
      throw new Error(
        error.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
      );
    }
  }

  // ═══════════════════════════════════════════════════════════
  // إلغاء Refresh Token
  // [FIX-3] يمسح من L1 Cache + inFlightValidations معاً
  // ═══════════════════════════════════════════════════════════
  static async revokeToken(tokenString) {
    try {
      const decoded = jwt.verify(tokenString, REFRESH_TOKEN_SECRET);
      const { id: userId, jti } = decoded;
      const sessionKey = `session:${userId}:${jti}`;
      const coalesceKey = `${userId}:${jti}`;

      // امسح من L1 Cache
      L1.del(sessionKey);

      // [FIX-3] امسح من Coalescing Map أيضاً لمنع إكمال طلب قيد المعالجة
      inFlightValidations.delete(coalesceKey);

      await redis.del(sessionKey).catch(() => {});
      await redis.srem(`user_sessions:${userId}`, jti).catch(() => {});
    } catch (e) {
      // صامت مقصود — الإلغاء يجب ألا يرمي استثناء للمُستدعي
    }
  }

  // ═══════════════════════════════════════════════════════════
  // تدوير Refresh Token (Rotation)
  // ═══════════════════════════════════════════════════════════
  static async validateAndRotate(tokenString, ip, fingerprint) {
    try {
      const decoded = jwt.verify(tokenString, REFRESH_TOKEN_SECRET);
      const { id: userId, jti } = decoded;

      logger.debug('[TokenService] Validating token structure', { userId, jti });

      const savedToken = await prisma.refreshToken.findUnique({ where: { jti } });

      if (!savedToken) {
        logger.warn('[TokenService] Token not found in DB', { jti, userId });
        throw new Error('INVALID_TOKEN');
      }

      if (savedToken.isRevoked || savedToken.isUsed) {
        logger.security('[BREACH_DETECTED] Refresh token reuse attempted', {
          userId, jti,
          isRevoked: savedToken.isRevoked,
          isUsed: savedToken.isUsed
        });
        if (savedToken.tokenFamily) {
          await prisma.refreshToken.updateMany({
            where: { tokenFamily: savedToken.tokenFamily },
            data: { isRevoked: true }
          });
          logger.security(
            '[TokenService] Token family invalidated due to reuse attempt',
            { family: savedToken.tokenFamily }
          );
        }
        throw new Error('TOKEN_REUSE_DETECTED');
      }

      const user =
        (await prisma.user.findUnique({ where: { uuid: userId } })) ||
        (await prisma.customer.findUnique({ where: { uuid: userId } }));

      if (!user || user.isActive === false || user.isBlacklisted === true) {
        throw new Error('ACCOUNT_DISABLED_OR_BLOCKED');
      }

      await prisma.refreshToken.update({
        where: { id: savedToken.id },
        data: { isUsed: true }
      });

      const { token: newRefreshToken, jti: newJti } =
        await this.generateAndSaveRefreshToken(user, {
          ip,
          fingerprint,
          familyId: savedToken.tokenFamily
        });

      const accessToken = this.generateAccessToken(user, newJti);

      return {
        accessToken,
        newRefreshToken: { token: newRefreshToken, jti: newJti },
        user
      };
    } catch (err) {
      if (err.name === 'TokenExpiredError') throw new Error('TOKEN_EXPIRED');
      if (
        ['TOKEN_REUSE_DETECTED', 'ACCOUNT_DISABLED_OR_BLOCKED'].includes(
          err.message
        )
      )
        throw err;
      throw new Error('INVALID_TOKEN');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // قائمة الجلسات النشطة
  // ═══════════════════════════════════════════════════════════
  static async getActiveSessions(userId) {
    const user = await prisma.user.findUnique({ where: { uuid: userId }, select: { id: true } });
    const customer = !user ? await prisma.customer.findUnique({ where: { uuid: userId }, select: { id: true } }) : null;

    if (!user && !customer) return [];

    const sessions = await prisma.refreshToken.findMany({
      where: {
        userId: user ? user.id : undefined,
        customerId: customer ? customer.id : undefined,
        isRevoked: false,
        isUsed: false,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    return sessions.map(s => ({
      id: s.jti,
      ip: 'Encrypted/Masked',
      lastUsed: s.updatedAt,
      createdAt: s.createdAt,
      isCurrent: false
    }));
  }

  // ═══════════════════════════════════════════════════════════
  // التحقق المعزز من حالة الجلسة
  // [FIX-1] withTimeout على Coalescing Promise لمنع Memory Leak
  // [FIX-2] L1 يُكتب بـ TTL أقصر (8s) عند نجاح Redis، ولا يُكتب عند الرفض
  // [FIX-3] revokeToken يمسح coalesceKey (مُطبَّق في revokeToken أعلاه)
  // ═══════════════════════════════════════════════════════════
  static async validateSessionState(decoded) {
    const { id: userId, sid: jti, av: tokenAv, pv: tokenPv } = decoded;
    const sessionKey = `session:${userId}:${jti}`;
    const coalesceKey = `${userId}:${jti}`;

    // ──────────────────────────────────────────────────────────
    // الطبقة ١: L1 Local Cache (0ms)
    // ──────────────────────────────────────────────────────────
    const localCached = L1.get(sessionKey);
    if (localCached !== undefined) {
      return localCached;
    }

    // ──────────────────────────────────────────────────────────
    // الطبقة ٢: Redis (بحد أقصى 500ms)
    // ──────────────────────────────────────────────────────────
    let cached = null;
    let redisFailed = false;

    try {
      cached = await Promise.race([
        redis.get(sessionKey),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('REDIS_TIMEOUT')), 500)
        )
      ]);
    } catch (err) {
      redisFailed = true;
      logger.warn(
        '[TokenService] Redis session lookup bypassed or timed out',
        { userId, jti, error: err.message }
      );
    }

    if (cached) {
      const session = JSON.parse(cached);
      const isValid = !(session.av > tokenAv || session.pv > tokenPv);
      const result = isValid
        ? { valid: true, session }
        : { valid: false, reason: 'VERSION_DRIFT' };

      // [FIX-2] اكتب في L1 فقط عند النجاح وبـ TTL أقصر (8 ثوانٍ)
      //         الرفض (VERSION_DRIFT) لا يُكتب في L1 لضمان إعادة التحقق
      if (isValid) {
        L1.set(sessionKey, result, 8);
      }

      return result;
    }

    // ──────────────────────────────────────────────────────────
    // الطبقة ٣: Request Coalescing (دمج الطلبات المتزامنة)
    // ──────────────────────────────────────────────────────────
    if (inFlightValidations.has(coalesceKey)) {
      return inFlightValidations.get(coalesceKey);
    }

    // ──────────────────────────────────────────────────────────
    // الطبقة ٤: DB Fallback
    // [FIX-1] مُلفوف بـ withTimeout (3 ثوانٍ) لمنع Memory Leak
    // ──────────────────────────────────────────────────────────
    const rawPromise = (async () => {
      try {
        const tokenRecord = await prisma.refreshToken.findUnique({
          where: { jti }
        });

        if (!tokenRecord || tokenRecord.isRevoked || tokenRecord.isUsed) {
          return { valid: false, reason: 'STATE_INVALIDATED' };
        }

        let account = null;
        if (tokenRecord.role === 'customer') {
          account = await prisma.customer.findUnique({
            where: { id: tokenRecord.customerId }
          });
        } else {
          account = await prisma.user.findUnique({
            where: { id: tokenRecord.userId }
          });
        }

        if (
          !account ||
          account.isActive === false ||
          account.isBlacklisted === true
        ) {
          return { valid: false, reason: 'USER_INACTIVE' };
        }

        if (
          account.authVersion > tokenAv ||
          account.permissionVersion > tokenPv
        ) {
          return { valid: false, reason: 'VERSION_DRIFT' };
        }

        const result = { valid: true, session: tokenRecord };

        if (redisFailed) {
          // Redis معطل: اكتب في L1 بـ TTL كاملة (15 ثانية)
          L1.set(sessionKey, result);
        } else {
          // Redis يعمل: أعد بناء الكاش عند تعافيه
          await redis
            .set(
              sessionKey,
              JSON.stringify({
                sid: jti,
                uid: userId,
                role: tokenRecord.role,
                branchId: account.branchId || null,
                av: account.authVersion,
                pv: account.permissionVersion
              }),
              'EX',
              3600
            )
            .catch(() => {});
        }

        return result;
      } catch (err) {
        logger.error(
          '[TokenService] Session validation crash — failing closed for security',
          { jti, error: err.message }
        );
        return { valid: false, reason: 'VALIDATION_ERROR' };
      }
    })();

    // [FIX-1] إذا تجاوز الـ Promise 3 ثوانٍ → أرجع VALIDATION_TIMEOUT
    //         بدلاً من التجمد وإبقاء المدخل في Map إلى الأبد
    const validationPromise = withTimeout(
      rawPromise,
      3000,
      { valid: false, reason: 'VALIDATION_TIMEOUT' }
    );

    inFlightValidations.set(coalesceKey, validationPromise);

    try {
      const finalResult = await validationPromise;

      // اكتب في L1 حتى النتائج الفاشلة (Negative Caching)
      // لمنع إغراق DB بالاستعلامات عن جلسات ملغاة
      L1.set(sessionKey, finalResult);

      return finalResult;
    } finally {
      // [FIX-1] finally يضمن الحذف من Map حتى عند أي استثناء خارجي
      inFlightValidations.delete(coalesceKey);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // مسح L1 Cache يدوياً (للاستخدام عند تغيير الصلاحيات)
  // ═══════════════════════════════════════════════════════════
  static invalidateL1Cache(userId, jti) {
    const sessionKey = `session:${userId}:${jti}`;
    const coalesceKey = `${userId}:${jti}`;
    L1.del(sessionKey);
    inFlightValidations.delete(coalesceKey);
  }

  // ═══════════════════════════════════════════════════════════
  // مسح كامل لكاش مستخدم (عند تغيير كلمة المرور أو الصلاحيات)
  // ═══════════════════════════════════════════════════════════
  static invalidateUserL1Cache(userId) {
    const keys = L1.keys().filter(k => k.startsWith(`session:${userId}:`));
    keys.forEach(k => L1.del(k));
    logger.debug('[TokenService] L1 cache cleared for user', {
      userId,
      keysCleared: keys.length
    });
  }
}

module.exports = TokenService;
