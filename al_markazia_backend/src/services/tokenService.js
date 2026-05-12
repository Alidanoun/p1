const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const prisma = require('../lib/prisma');
const redis = require('../lib/redis'); 
const auditService = require('./auditService');

const {
  JWT_SECRET: ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY_MS,
  JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY
} = require('../config/secrets');

const PRIVATE_KEY = JWT_PRIVATE_KEY;
const PUBLIC_KEY = JWT_PUBLIC_KEY;

/**
 * 🏰 Enterprise Token Service (Hardened v3)
 * Implements Session Registry, Auth/Permission Versioning, and Hybrid Fallback.
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
    await redis.set(sessionKey, JSON.stringify(sessionData), 'EX', ttlSeconds);
    await redis.sadd(`user_sessions:${userId}`, jti);
    await redis.expire(`user_sessions:${userId}`, ttlSeconds);

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
    }).catch(e => logger.error('[TokenService] DB backup failed', { error: e.message }));

    return { token, jti, family };
  }

  static async validateAndRotate(oldTokenString, clientIp = 'unknown', currentFingerprint = null) {
    const decoded = jwt.verify(oldTokenString, REFRESH_TOKEN_SECRET);
    const { id: userId, jti: oldJti, role } = decoded;

    const sessionKey = `session:${userId}:${oldJti}`;
    const sessionDataRaw = await redis.get(sessionKey);
    
    if (!sessionDataRaw) throw new Error('SESSION_EXPIRED');
    const sessionData = JSON.parse(sessionDataRaw);

    // 🛡️ Security Checks
    if (sessionData.fingerprint && currentFingerprint && sessionData.fingerprint !== currentFingerprint.hash) {
      await this.revokeAllUserSessions(userId);
      throw new Error('SECURITY_BREACH');
    }

    // Resolve User for fresh versions
    let user = await prisma.user.findUnique({ where: { uuid: userId } });
    let isUserEntity = true;
    if (!user) {
      user = await prisma.customer.findUnique({ where: { uuid: userId } });
      isUserEntity = false;
    }

    const isInactive = isUserEntity 
      ? (!user || !user.isActive) 
      : (!user || user.isDeleted || user.isBlacklisted);

    if (isInactive) throw new Error('USER_INACTIVE');

    // Atomic Rotation
    const { token: newRefreshToken, jti: newJti } = await this.generateAndSaveRefreshToken(user, {
      ip: clientIp,
      fingerprint: currentFingerprint?.hash
    });
    const accessToken = this.generateAccessToken(user, newJti);

    // Remove old session
    await redis.del(sessionKey);
    await redis.srem(`user_sessions:${userId}`, oldJti);

    return { accessToken, newRefreshToken: { token: newRefreshToken }, user };
  }

  static async validateSessionState(decoded) {
    const { id: userId, sid: jti, av: tokenAv, pv: tokenPv } = decoded;
    const sessionKey = `session:${userId}:${jti}`;
    let sessionData = await redis.get(sessionKey);

    if (sessionData) {
      sessionData = JSON.parse(sessionData);
      if (sessionData.av !== tokenAv || sessionData.pv !== tokenPv) return { valid: false, reason: 'VERSION_DRIFT' };
      return { valid: true, session: sessionData };
    }

    // Authority Fallback
    let user = await prisma.user.findUnique({ where: { uuid: userId }, select: { authVersion: true, permissionVersion: true, isActive: true, role: true, branchId: true } });
    let isUserEntity = true;
    if (!user) {
      user = await prisma.customer.findUnique({ where: { uuid: userId }, select: { authVersion: true, permissionVersion: true, isBlacklisted: true, isDeleted: true } });
      isUserEntity = false;
    }

    const isInactive = isUserEntity 
      ? (!user || !user.isActive) 
      : (!user || user.isDeleted || user.isBlacklisted);

    if (isInactive) return { valid: false, reason: 'USER_INACTIVE' };
    if (user.authVersion !== tokenAv || user.permissionVersion !== tokenPv) return { valid: false, reason: 'STATE_INVALIDATED' };

    const role = isUserEntity ? user.role : 'customer';
    const branchId = isUserEntity ? user.branchId : null;

    await redis.set(sessionKey, JSON.stringify({ sid: jti, uid: userId, role, branchId, av: user.authVersion, pv: user.permissionVersion }), 'EX', 3600);
    return { valid: true };
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
      await redis.del(`session:${decoded.id}:${decoded.jti}`);
      await redis.srem(`user_sessions:${decoded.id}`, decoded.jti);
    } catch (e) {}
  }

  static async revokeAllUserSessions(userId) {
    const sessionsKey = `user_sessions:${userId}`;
    const sids = await redis.smembers(sessionsKey);
    if (sids.length > 0) {
      const keysToDelete = sids.map(sid => `session:${userId}:${sid}`);
      await redis.del(...keysToDelete, sessionsKey);
    }
    await prisma.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } }).catch(() => {});
  }
}

module.exports = TokenService;
