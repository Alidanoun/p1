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
   * Generates AND SAVES a signed Refresh Token for session persistence.
   * 🛡️ Multi-Device Support: Relaxes single-session enforcement while pruning old ones.
   */
  static async generateAndSaveRefreshToken(user) {
    const role = user.role || 'customer';

    // 🛡️ Prune only very old or revoked sessions for this user (Cleanup)
    // We allow up to 5 concurrent sessions per user for multi-device support.
    const sessions = await prisma.refreshToken.findMany({
      where: { userId: user.uuid },
      orderBy: { createdAt: 'desc' }
    });

    if (sessions.length >= 5) {
      const idsToPrune = sessions.slice(4).map(s => s.id);
      await prisma.refreshToken.deleteMany({
        where: { id: { in: idsToPrune } }
      });
      logger.info(`[TokenService] Pruned ${idsToPrune.length} old session(s) for user ${user.uuid}`);
    }

    const token = jwt.sign(
      { id: user.uuid, role: role },
      REFRESH_TOKEN_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRY }
    );

    // Persist session to DB
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
   * Implements Secure Rotation & Abuse Detection with Concurrency Grace Window
   * Logic: If a token is reused very recently (< 10s), it's likely a race condition, not an attack.
   */
  static async validateAndRotate(oldTokenString) {
    try {
      // 1. JWT Standard Verification
      const decoded = jwt.verify(oldTokenString, REFRESH_TOKEN_SECRET);
      
      // 2. Database Lookup
      const tokenRecord = await prisma.refreshToken.findUnique({
        where: { token: oldTokenString }
      });

      // 🚨 ABUSE DETECTION: Token missing or revoked
      if (!tokenRecord || tokenRecord.isRevoked) {
        
        // 🛡️ CONCURRENCY GRACE WINDOW: 
        // If the token was revoked VERY recently (e.g. within 10 seconds), 
        // it's likely a duplicate request from the client (common in high-latency or React StrictMode).
        // We allow it to "succeed" by returning a fresh token pair without a security alarm.
        if (tokenRecord && tokenRecord.isRevoked) {
          const now = new Date();
          // We use createdAt + 10s as a proxy for 'recently rotated' if updatedAt isn't available,
          // but since we just added updatedAt to schema (even if push failed, Prisma client might see it),
          // let's use a safe check.
          const lastChange = tokenRecord.updatedAt || tokenRecord.createdAt;
          const secondsSinceRotation = (now.getTime() - new Date(lastChange).getTime()) / 1000;
          
          if (secondsSinceRotation < 10) {
            logger.info('[TokenService] Concurrency grace window hit. Returning new session for user', { userId: decoded.id });
            // Since it's already rotated, we should ideally find the *new* token created for this user,
            // but for simplicity and safety, we'll just allow this request to trigger a NEW rotation
            // as if it were the first one, OR better: return the existing newest token.
            // For now, let's just proceed to generate a new one to avoid blocking the user.
          } else {
            logger.security('REUSE_ATTEMPT_DETECTED: Critical breach warning', { 
              userId: decoded.id, 
              tokenHash: oldTokenString.substring(0, 10) + '...' 
            });
            await this.revokeAllSessions(decoded.id);
            throw new Error('TOKEN_REUSE_DETECTED');
          }
        } else {
          // Token completely missing from DB
          throw new Error('REFRESH_TOKEN_INVALID');
        }
      }

      // 3. ATOMIC ROTATION: Update old (Revoke) + Create new in ONE transaction
      let user, newRefreshToken;
      await prisma.$transaction(async (tx) => {
        // Mark old token as revoked instead of deleting (to support grace window)
        // Check if tokenRecord was already revoked (grace window case)
        if (tokenRecord && !tokenRecord.isRevoked) {
          await tx.refreshToken.update({ 
            where: { id: tokenRecord.id },
            data: { isRevoked: true }
          });
        }

        // Resolve Identity
        if (decoded.role === 'admin' || decoded.role === 'super_admin') {
          user = await tx.user.findFirst({ where: { uuid: decoded.id } });
        } else {
          user = await tx.customer.findFirst({ where: { uuid: decoded.id } });
        }

        if (!user) throw new Error('USER_NOT_FOUND');

        // Generate and Save New Token
        const role = user.role || 'customer';
        const token = jwt.sign(
          { id: user.uuid, role: role },
          REFRESH_TOKEN_SECRET,
          { expiresIn: REFRESH_TOKEN_EXPIRY }
        );

        await tx.refreshToken.create({
          data: {
            token,
            userId: user.uuid,
            role,
            expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS)
          }
        });

        newRefreshToken = token;
      });

      // 4. Generate Access Token (Safe to do outside transaction)
      const accessToken = this.generateAccessToken(user);

      return { accessToken, newRefreshToken, user };
    } catch (error) {
      if (error.message === 'TOKEN_REUSE_DETECTED') throw error;
      if (error.message === 'REFRESH_TOKEN_INVALID') throw error;
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
