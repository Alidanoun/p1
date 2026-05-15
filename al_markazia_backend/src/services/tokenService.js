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
        new Promise((_, reject) => setTimeout(() => reject(new Error('REDIS_TIMEOUT')), 2000))
      ]);
    } catch (err) {
      logger.warn('[TokenService] Redis session registry skipped or timed out, relying on DB fallback', { userId, error: err.message });
    }

    // 🛡️ Permanent DB Registry (Source of Truth)
    await prisma.refreshToken.create({
      data: {
        token,
        userId,
        role,
        jti,
        tokenFamily: family,
        fingerprint: context.fingerprint,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS)
      }
    }).catch(e => logger.error('[TokenService] DB token creation failed', { error: e.message }));

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
}

module.exports = TokenService;
