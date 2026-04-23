const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const prisma = require('../lib/prisma');

const {
  JWT_SECRET: ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY_MS
} = require('../config/secrets');

/**
 * Enterprise Token Service (Level 4 Security)
 * Handles generation, DB-backed storage, and rotation of JWT tokens.
 */
class TokenService {
  /**
   * Generates a signed Access Token for short-term authorization
   */
  static generateAccessToken(user) {
    return jwt.sign(
      { 
        id: user.uuid, 
        phone: user.phone,
        role: user.role || 'customer'
      },
      ACCESS_TOKEN_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );
  }

  /**
   * Generates AND SAVES a signed Refresh Token for session persistence
   */
  static async generateAndSaveRefreshToken(user) {
    const role = user.role || 'customer';
    const token = jwt.sign(
      { id: user.uuid, role: role }, // 🚀 Role added for server-side lookup
      REFRESH_TOKEN_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRY }
    );

    // Persist to DB for revocation support
    await prisma.refreshToken.create({
      data: {
        token,
        userId: user.uuid,
        role,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS)
      }
    });

    return token;
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
   * Implements Secure Rotation & Abuse Detection
   * Logic: If a token is reused or missing from DB while being a valid JWT -> REUSE DETECTED.
   */
  static async validateAndRotate(oldTokenString) {
    try {
      // 1. JWT Standard Verification
      const decoded = jwt.verify(oldTokenString, REFRESH_TOKEN_SECRET);
      
      // 2. Database Lookup
      const tokenRecord = await prisma.refreshToken.findUnique({
        where: { token: oldTokenString }
      });

      // 🚨 ABUSE DETECTION: Token used but not in DB (or revoked)
      if (!tokenRecord || tokenRecord.isRevoked) {
        logger.security('REUSE_ATTEMPT_DETECTED: Critical breach warning', { 
          userId: decoded.id, 
          tokenHash: oldTokenString.substring(0, 10) + '...' 
        });
        
        // Nuclear Option: Invalidate ALL sessions for this user
        await this.revokeAllSessions(decoded.id);
        throw new Error('TOKEN_REUSE_DETECTED');
      }

      // 3. Delete Old Token (Invalidation)
      await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });

      // 4. Resolve Identity
      let user;
      if (decoded.role === 'admin' || decoded.role === 'super_admin') {
        user = await prisma.user.findFirst({ where: { uuid: decoded.id } });
      } else {
        user = await prisma.customer.findFirst({ where: { uuid: decoded.id } });
      }

      if (!user) throw new Error('USER_NOT_FOUND');

      // 5. Generate New Pair
      const accessToken = this.generateAccessToken(user);
      const newRefreshToken = await this.generateAndSaveRefreshToken(user);

      return { accessToken, newRefreshToken, user };
    } catch (error) {
      if (error.message === 'TOKEN_REUSE_DETECTED') throw error;
      throw new Error('REFRESH_TOKEN_INVALID');
    }
  }

  /**
   * Manual Revocation (Logout)
   */
  static async revokeToken(tokenString) {
    await prisma.refreshToken.deleteMany({ where: { token: tokenString } });
  }

  /**
   * Panic Revocation (Security Breach)
   */
  static async revokeAllSessions(userId) {
    await prisma.refreshToken.deleteMany({ where: { userId } });
    logger.info('Panic: All sessions revoked for user', { userId });
  }
}

module.exports = TokenService;
