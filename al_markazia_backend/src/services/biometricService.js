const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { encrypt, decrypt } = require('../utils/crypto');
const auditService = require('./auditService');
const TokenService = require('./tokenService');
const { REFRESH_TOKEN_SECRET } = require('../config/secrets');

/**
 * 🧬 Dedicated Biometric Authentication Service
 * Strictly governs persistent hardware device trust bindings, signature lifecycle,
 * symmetric database storage protection, and high-tolerance background token unlocking.
 */
class BiometricService {
  /**
   * 1. Enable/Register Biometric Trusted Device Binding
   */
  async enableDevice(userUuid, deviceId, metadata = {}, req = null) {
    if (!userUuid || !deviceId) {
      throw new Error('INVALID_PARAMETERS');
    }

    // Resolve target role context safely across tenant collections
    let role = 'customer';
    const userAcc = await prisma.user.findUnique({ where: { uuid: userUuid }, select: { role: true, isActive: true } });
    if (userAcc) {
      if (!userAcc.isActive) throw new Error('USER_INACTIVE');
      role = userAcc.role;
    } else {
      const custAcc = await prisma.customer.findUnique({ where: { uuid: userUuid }, select: { isActive: true } });
      if (!custAcc) throw new Error('USER_NOT_FOUND');
      role = 'customer';
    }

    // Generate persistent credential signed with dedicated cryptographic claim flags
    const rawToken = jwt.sign(
      { 
        id: userUuid, 
        deviceId: String(deviceId), 
        role, 
        biometric: true,
        iat: Math.floor(Date.now() / 1000)
      },
      REFRESH_TOKEN_SECRET,
      { expiresIn: '365d' } // Long-lived hardware persistence trust
    );

    // Secure token at rest via AES-256 symmetric cipher wrapper
    const encryptedToken = encrypt(rawToken);

    // Upsert database record atomically
    const record = await prisma.biometricDevice.upsert({
      where: { deviceId: String(deviceId) },
      update: {
        userId: userUuid,
        token: encryptedToken,
        isActive: true,
        metadata: metadata || {},
        updatedAt: new Date()
      },
      create: {
        userId: userUuid,
        deviceId: String(deviceId),
        token: encryptedToken,
        isActive: true,
        metadata: metadata || {}
      }
    });

    // Audit execution
    await auditService.log({
      userId: userUuid,
      userRole: role,
      action: 'BIOMETRIC_ENABLE',
      status: 'SUCCESS',
      severity: 'INFO',
      metadata: { deviceId },
      req
    });

    logger.security(`[Biometric Trust] Enabled physical device binding for account: ${userUuid}`);
    return { biometricToken: rawToken, deviceId: record.deviceId };
  }

  /**
   * 2. Unlock/Bootstrap Runtime Session via Physical Hardware Validation
   */
  async unlockDevice(biometricToken, deviceId, req = null) {
    if (!biometricToken || !deviceId) {
      throw new Error('MISSING_CREDENTIALS');
    }

    let decoded;
    try {
      decoded = jwt.verify(biometricToken, REFRESH_TOKEN_SECRET);
    } catch (err) {
      logger.security('[Biometric Unlock] Signature validation failure intercepted', { error: err.message });
      throw new Error('BIOMETRIC_TOKEN_EXPIRED_OR_INVALID');
    }

    // 🛡️ Hardware Drift Verification and Replay Attack Protection
    if (!decoded.biometric || decoded.deviceId !== String(deviceId)) {
      await auditService.log({
        userId: decoded.id || 'unknown',
        action: 'BIOMETRIC_UNLOCK',
        status: 'FAIL',
        severity: 'CRITICAL',
        metadata: { reason: 'DEVICE_ID_MISMATCH_REPLAY_ATTACK', deviceId, tokenDeviceId: decoded.deviceId },
        req
      });
      throw new Error('SECURITY_BREACH_DEVICE_MISMATCH');
    }

    const targetUserId = decoded.id;

    // Verify active persistence state
    const deviceRecord = await prisma.biometricDevice.findUnique({
      where: { deviceId: String(deviceId) }
    });

    if (!deviceRecord || !deviceRecord.isActive) {
      throw new Error('DEVICE_TRUST_REVOKED');
    }

    // Verify token identity at rest decrypts cleanly to current request context
    const storedPlain = decrypt(deviceRecord.token);
    if (storedPlain !== biometricToken) {
      throw new Error('CREDENTIAL_INTEGRITY_COMPROMISED');
    }

    // Resolve active base account entity
    let account = await prisma.user.findUnique({ 
      where: { uuid: targetUserId },
      include: { branch: true } 
    });
    let isUserEntity = true;

    if (!account) {
      account = await prisma.customer.findUnique({ where: { uuid: targetUserId } });
      isUserEntity = false;
    }

    if (!account || (account.isActive !== undefined && !account.isActive)) {
      throw new Error('ACCOUNT_DISABLED_OR_BLOCKED');
    }

    // Bypass volatile Redis cache session lookup and sec-ch-ua drift filters completely!
    // Issue standard operational tokens directly to authorize UI lifecycle operations.
    const clientIp = req?.ip || req?.headers['x-forwarded-for'] || 'biometric-channel';
    
    const { token: newRefreshTokenString, jti } = await TokenService.generateAndSaveRefreshToken(account, {
      ip: clientIp,
      userAgent: req?.headers['user-agent'] || 'biometric-unlock',
      fingerprint: 'biometric-hardware-trusted' // Explicit custom marker to pass future middleware checks safely
    });

    const accessToken = TokenService.generateAccessToken(account, jti);

    // Audit successful authentication channel resolution
    await auditService.log({
      userId: targetUserId,
      userRole: account.role || 'customer',
      action: 'BIOMETRIC_UNLOCK',
      status: 'SUCCESS',
      severity: 'INFO',
      metadata: { deviceId },
      req
    });

    logger.info(`[Biometric Unlock] 🔓 Successfully bootstrapped verified runtime session for account: ${targetUserId}`);

    return {
      accessToken,
      refreshToken: newRefreshTokenString,
      user: {
        id: account.uuid,
        email: decrypt(account.email) || null,
        name: decrypt(account.name) || null,
        phone: decrypt(account.phone) || null,
        role: account.role || 'customer',
        branchId: account.branchId || null,
        branchName: account.branch?.name || null
      }
    };
  }

  /**
   * 3. Disable/Revoke Hardware Binding
   */
  async disableDevice(userUuid, deviceId, req = null) {
    if (!userUuid || !deviceId) throw new Error('INVALID_PARAMETERS');

    const result = await prisma.biometricDevice.updateMany({
      where: { userId: userUuid, deviceId: String(deviceId) },
      data: { isActive: false, updatedAt: new Date() }
    });

    if (result.count > 0) {
      await auditService.log({
        userId: userUuid,
        action: 'BIOMETRIC_DISABLE',
        status: 'SUCCESS',
        severity: 'INFO',
        metadata: { deviceId },
        req
      });
      logger.security(`[Biometric Trust] Revoked persistent hardware binding: ${deviceId}`);
    }

    return result.count > 0;
  }
}

module.exports = new BiometricService();
