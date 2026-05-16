const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const prisma = require('../lib/prisma');
const redis = require('../lib/redis'); 

const {
  JWT_PRIVATE_KEY: PRIVATE_KEY,
  JWT_PUBLIC_KEY: PUBLIC_KEY,
  REFRESH_TOKEN_SECRET,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY_MS
} = require('../config/secrets');

/**
 * 🏰 Enterprise Token Service (Hardened v3.1)
 * Implements Session Registry with Redis Hybrid Fallback.
 */
class TokenService {
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

  /**
   * 🔄 Generate and Registry Session
   * Uses Redis for performance, but falls back gracefully to DB on latency/failure.
   */
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
    const sessionData = {
      sid: jti,
      uid: userId,
      role,
      branchId: user.branchId || null,
      av: user.authVersion || 1,
      pv: user.permissionVersion || 1,
      ip: context.ip || 'unknown',
      ua: context.userAgent || 'unknown',
      fingerprint: context.fingerprint || null,
      createdAt: new Date().toISOString()
    };

    const ttlSeconds = Math.floor(REFRESH_TOKEN_EXPIRY_MS / 1000);

    // 🏎️ Redis Session Storage with 2s Timeout Guard
    try {
      await Promise.race([
        Promise.all([
          redis.set(sessionKey, JSON.stringify(sessionData), 'EX', ttlSeconds),
          redis.sadd(`user_sessions:${userId}`, jti),
          redis.expire(`user_sessions:${userId}`, ttlSeconds)
        ]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('REDIS_TIMEOUT')), 500))
      ]);
    } catch (err) {
      logger.warn('[TokenService] Redis session registry skipped or timed out, relying on DB fallback', { userId, error: err.message });
    }

    // 🛡️ Permanent DB Registry (Source of Truth)
    try {
      await prisma.refreshToken.create({
        data: {
          token,
          userId,
          role,
          jti,
          tokenFamily: family,
          fingerprint: context.fingerprint ? JSON.stringify(context.fingerprint) : null,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS)
        }
      });
    } catch (dbErr) {
      logger.error('[TokenService] DB token creation failed. Rolling back Redis session.', { error: dbErr.message, userId, jti });
      
      // 🔄 Compensating Rollback: Remove from Redis to maintain consistency
      await Promise.all([
        redis.del(sessionKey),
        redis.srem(`user_sessions:${userId}`, jti)
      ]).catch(rErr => logger.error('[TokenService] Redis rollback failed', { error: rErr.message }));
      
      throw new Error('SESSION_CREATION_FAILED');
    }

    return { token, jti, family };
  }

  static verifyAccessToken(token) {
    try {
      return jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] });
    } catch (error) {
      throw new Error(error.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN');
    }
  }

  static async revokeToken(tokenString) {
    try {
      const decoded = jwt.verify(tokenString, REFRESH_TOKEN_SECRET);
      await redis.del(`session:${decoded.id}:${decoded.jti}`).catch(() => {});
      await redis.srem(`user_sessions:${decoded.id}`, decoded.jti).catch(() => {});
    } catch (e) {}
  }

  /**
   * 🔄 Validate and Rotate Refresh Token
   * Implements strict "Reuse Detection" and "Family Rotation".
   */
  static async validateAndRotate(tokenString, ip, fingerprint) {
    try {
      // 1. JWT Structural Verification
      const decoded = jwt.verify(tokenString, REFRESH_TOKEN_SECRET);
      const { id: userId, jti } = decoded;

      logger.debug('[TokenService] Validating token structure', { userId, jti });

      // 2. Lookup Token in Database
      const savedToken = await prisma.refreshToken.findUnique({
        where: { jti }
      });

      if (!savedToken) {
        logger.warn('[TokenService] Token not found in DB', { jti, userId });
        throw new Error('INVALID_TOKEN');
      }

      // 🛡️ REUSE DETECTION: If token exists but is already used/revoked
      if (savedToken.isRevoked || savedToken.isUsed) {
        logger.security('[BREACH_DETECTED] Refresh token reuse attempted', { 
          userId, jti, isRevoked: savedToken.isRevoked, isUsed: savedToken.isUsed 
        });

        if (savedToken.tokenFamily) {
          await prisma.refreshToken.updateMany({
            where: { tokenFamily: savedToken.tokenFamily },
            data: { isRevoked: true }
          });
          logger.security('[TokenService] Token family invalidated due to reuse attempt', { family: savedToken.tokenFamily });
        }
        throw new Error('TOKEN_REUSE_DETECTED');
      }

      // 3. Status Check (User existence & active state)
      const user = await prisma.user.findUnique({ where: { uuid: userId } }) 
                || await prisma.customer.findUnique({ where: { uuid: userId } });

      if (!user || (user.isActive === false) || (user.isBlacklisted === true)) {
        throw new Error('ACCOUNT_DISABLED_OR_BLOCKED');
      }

      // 4. Mark old token as used
      await prisma.refreshToken.update({
        where: { id: savedToken.id },
        data: { isUsed: true }
      });

      // 5. Generate New Pair (Rotate)
      const { token: newRefreshToken, jti: newJti } = await this.generateAndSaveRefreshToken(user, {
        ip,
        fingerprint,
        familyId: savedToken.tokenFamily // Keep the same family
      });

      const accessToken = this.generateAccessToken(user, newJti);

      return { 
        accessToken, 
        newRefreshToken: { token: newRefreshToken, jti: newJti }, 
        user 
      };

    } catch (err) {
      if (err.name === 'TokenExpiredError') throw new Error('TOKEN_EXPIRED');
      if (['TOKEN_REUSE_DETECTED', 'ACCOUNT_DISABLED_OR_BLOCKED'].includes(err.message)) throw err;
      throw new Error('INVALID_TOKEN');
    }
  }

  /**
   * 📡 Get All Active Sessions for a user
   */
  static async getActiveSessions(userId) {
    const sessions = await prisma.refreshToken.findMany({
      where: { 
        userId, 
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
      isCurrent: false // Frontend will determine this
    }));
  }

  /**
   * 🛡️ Validates Session State (Hybrid Authority)
   * Essential for preventing access after role changes or revocation.
   */
  static async validateSessionState(decoded) {
    const { id: userId, sid: jti, av: tokenAv, pv: tokenPv } = decoded;

    try {
      // 1. 🏎️ Fast Track (Redis)
      const cached = await redis.get(`session:${userId}:${jti}`).catch(() => null);
      if (cached) {
        const session = JSON.parse(cached);
        // Version Drift Detection
        if (session.av > tokenAv || session.pv > tokenPv) {
          return { valid: false, reason: 'VERSION_DRIFT' };
        }
        return { valid: true, session };
      }

      // 2. 🛡️ Authority Fallback (DB)
      const tokenRecord = await prisma.refreshToken.findUnique({
        where: { jti }
      });

      if (!tokenRecord || tokenRecord.isRevoked || tokenRecord.isUsed) {
        return { valid: false, reason: 'STATE_INVALIDATED' };
      }

      // Query account based on role and userId
      let account = null;
      if (tokenRecord.role === 'customer') {
        account = await prisma.customer.findUnique({ where: { uuid: tokenRecord.userId } });
      } else {
        account = await prisma.user.findUnique({ where: { uuid: tokenRecord.userId } });
      }

      if (!account || (account.isActive === false) || (account.isBlacklisted === true)) {
        return { valid: false, reason: 'USER_INACTIVE' };
      }

      // Sync Version Drift from DB
      if (account.authVersion > tokenAv || account.permissionVersion > tokenPv) {
        return { valid: false, reason: 'VERSION_DRIFT' };
      }

      return { valid: true, session: tokenRecord };
    } catch (err) {
      logger.error('Session validation crash', { jti, error: err.message });
      return { valid: true }; // Fail-open to avoid service outage, but log error
    }
  }
}

module.exports = TokenService;
