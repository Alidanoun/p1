const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const prisma = require('../lib/prisma');
const redis = require('../lib/redis');

const {
  JWT_SECRET: ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY_MS
} = require('../config/secrets');

/**
 * Enterprise Token Service (Level 4 Security)
 * Handles generation, Redis-backed session management, and JTI rotation.
 */
class TokenService {
  /**
   * Generates a signed Access Token for short-term authorization
   */
  static generateAccessToken(user, jti) {
    return jwt.sign(
      { 
        id: user.uuid, 
        phone: user.phone,
        role: user.role || 'customer',
        jti: jti // Bind to session
      },
      ACCESS_TOKEN_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );
  }

  /**
   * Generates AND SAVES a signed Refresh Token to Redis.
   * 🛡️ JTI-based Session Store: Allows instant revocation and multi-device tracking.
   */
  static async generateAndSaveRefreshToken(user) {
    const role = user.role || 'customer';
    const jti = uuidv4(); // Unique Session Identifier
    const userId = user.uuid;

    const token = jwt.sign(
      { id: userId, role: role, jti: jti },
      REFRESH_TOKEN_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRY }
    );

    // 🚀 Store in Redis: Hot Storage for Active Sessions
    const sessionKey = `session:${userId}:${jti}`;
    const sessionData = {
      jti,
      userId,
      role,
      createdAt: new Date().toISOString()
    };

    // Save to Redis with expiry (matched to Refresh Token duration)
    const ttlSeconds = Math.floor(REFRESH_TOKEN_EXPIRY_MS / 1000);
    await redis.set(sessionKey, JSON.stringify(sessionData), 'EX', ttlSeconds);

    // 📊 Backup to DB: Cold Storage (Optional but recommended for audit)
    await prisma.refreshToken.create({
      data: {
        token,
        userId: userId,
        role,
        jti: jti, // Ensure jti is in your schema or add it
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS)
      }
    }).catch(e => logger.error('Cold storage backup failed', { error: e.message }));

    return { token, jti };
  }

  /**
   * Verifies an Access Token and returns the decoded payload
   */
  static verifyAccessToken(token) {
    try {
      return jwt.verify(token, ACCESS_TOKEN_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('TOKEN_EXPIRED');
      }
      throw new Error('INVALID_TOKEN');
    }
  }

  /**
   * Implements Secure Rotation & Abuse Detection with Redis Session Validation
   * 🛡️ Enhanced with a 30s Idempotent Grace Period to handle race conditions.
   */
  static async validateAndRotate(oldTokenString, clientIp = 'unknown') {
    try {
      // 🛡️ Pre-validation Sanitization
      if (!oldTokenString || typeof oldTokenString !== 'string' || !oldTokenString.includes('.')) {
        throw new Error('MALFORMED_TOKEN_FORMAT');
      }

      // 1. JWT Standard Verification
      const decoded = jwt.verify(oldTokenString, REFRESH_TOKEN_SECRET);
      const { id: userId, jti: oldJti, role } = decoded;

      if (!oldJti) throw new Error('MALFORMED_TOKEN');

      // 2. Redis Session Lookup (Source of Truth)
      const sessionKey = `session:${userId}:${oldJti}`;
      const sessionDataRaw = await redis.get(sessionKey);

      if (!sessionDataRaw) {
        logger.security('[REFRESH_REUSE_DETECTED] Critical: Token not in Redis.', { userId, oldJti });
        await this.revokeAllSessions(userId);
        throw new Error('SESSION_REVOKED_OR_EXPIRED');
      }

      const sessionData = JSON.parse(sessionDataRaw);

      // 🔄 [GRACE PERIOD LOGIC] Handle concurrent refresh requests (e.g. React StrictMode)
      if (sessionData.status === 'ROTATED') {
        // 🛡️ IP Check: Only allow grace period if the IP matches the one that rotated it
        if (sessionData.rotatedIp !== clientIp) {
          logger.security('[REFRESH_REUSE_DETECTED] Warning: Rotated token used from different IP.', { userId, oldJti, originalIp: sessionData.rotatedIp, newIp: clientIp });
          await this.revokeAllSessions(userId);
          throw new Error('SECURITY_BREACH');
        }

        logger.info('[REFRESH_GRACE_ACCEPTED] Race condition handled. Returning idempotent response.', { userId, oldJti });
        return { 
          accessToken: sessionData.idempotentResponse.accessToken, 
          newRefreshToken: { token: sessionData.idempotentResponse.refreshToken },
          user: { uuid: userId, role } // Basic user data for response
        };
      }

      // 3. Resolve Identity (Only if not rotated)
      let user;
      if (role === 'admin' || role === 'super_admin') {
        user = await prisma.user.findFirst({ where: { uuid: userId } });
      } else {
        user = await prisma.customer.findFirst({ where: { uuid: userId } });
      }

      if (!user) throw new Error('USER_NOT_FOUND');

      // 🛡️ [CRITICAL] Active Status Guard
      const isDisabled = (user.isActive === false) || (user.isBlacklisted === true);
      if (isDisabled) {
        logger.security('Rotation blocked: Account disabled/blacklisted', { userId });
        await this.revokeAllSessions(userId);
        throw new Error('ACCOUNT_DISABLED_OR_BLOCKED');
      }

      // 4. ATOMIC ROTATION
      // Generate New Pair
      const { token: newRefreshTokenString, jti: newJti } = await this.generateAndSaveRefreshToken(user);
      const accessToken = this.generateAccessToken(user, newJti);

      // 🕒 MARK AS ROTATED (Grace Period: 30s)
      // Instead of deleting, we keep it as a 'ghost' session to handle idempotent retries
      const gracePeriodData = {
        status: 'ROTATED',
        rotatedAt: new Date().toISOString(),
        rotatedIp: clientIp,
        idempotentResponse: {
          accessToken,
          refreshToken: newRefreshTokenString
        }
      };
      await redis.set(sessionKey, JSON.stringify(gracePeriodData), 'EX', 30);

      logger.info('[REFRESH_ROTATION] Token successfully rotated.', { userId, oldJti, newJti });

      return { 
        accessToken, 
        newRefreshToken: { token: newRefreshTokenString }, 
        user 
      };
    } catch (error) {
      if (error.message === 'SECURITY_BREACH') throw error;
      logger.error('Token Rotation Failed', { error: error.message });
      throw new Error('REFRESH_TOKEN_INVALID');
    }
  }

  /**
   * Manual Revocation (Logout)
   */
  static async revokeToken(tokenString) {
    try {
      const decoded = jwt.verify(tokenString, REFRESH_TOKEN_SECRET);
      const sessionKey = `session:${decoded.id}:${decoded.jti}`;
      await redis.del(sessionKey);
      await prisma.refreshToken.deleteMany({ where: { jti: decoded.jti } }).catch(() => {});
    } catch (e) {
      // Token might be malformed or already expired
    }
  }

  /**
   * Panic Revocation (Security Breach / Reset Password)
   */
  static async revokeAllSessions(userId) {
    // 1. Clear Redis (Safe SCAN pattern matching)
    const pattern = `session:${userId}:*`;
    let cursor = '0';
    let totalKeysFound = 0;

    do {
      const [newCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = newCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
        totalKeysFound += keys.length;
      }
    } while (cursor !== '0');

    // 2. Clear DB Backup
    await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => {});
    
    logger.info('Panic: All sessions revoked for user', { userId, totalKeysFound });
  }
}

module.exports = TokenService;

