// src/services/otpService.js
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { sendOtpEmail } = require('./emailService');

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_REQUESTS_PER_HOUR = 5;

class OtpService {
  /**
   * 🎲 Cryptographically secure OTP generation
   */
  _generateCode() {
    return crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');
  }

  /**
   * 🚀 Request OTP via Email (rate-limited, anti-enumeration)
   * @param {Object} params
   * @param {string} params.email - Target email address
   * @param {string} [params.purpose='login'] - 'login' | 'register' | 'password_reset'
   * @param {string} [params.ipAddress]
   * @param {string} [params.userAgent]
   */
  async requestOtp({ email, purpose = 'login', ipAddress, userAgent }) {
    const cleanEmail = email.toLowerCase().trim();

    // 1. Rate limit per email: Global hour limit
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentRequests = await prisma.otpCode.count({
      where: { email: cleanEmail, createdAt: { gte: oneHourAgo } }
    });

    if (recentRequests >= MAX_REQUESTS_PER_HOUR) {
      throw new Error('TOO_MANY_OTP_REQUESTS');
    }

    // 2. Resend Cooldown Check
    const lastOtp = await prisma.otpCode.findFirst({
      where: { email: cleanEmail, purpose, used: false },
      orderBy: { createdAt: 'desc' }
    });

    if (lastOtp) {
      const elapsed = (Date.now() - lastOtp.createdAt.getTime()) / 1000;
      if (elapsed < RESEND_COOLDOWN_SECONDS) {
        throw new Error(`RESEND_COOLDOWN:${Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed)}`);
      }
    }

    // 3. Generate Code & Hash
    const code = this._generateCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    // 4. Invalidate previous unused OTPs for this email/purpose
    await prisma.otpCode.updateMany({
      where: { email: cleanEmail, purpose, used: false },
      data: { used: true }
    });

    // 5. Save OTP Hash to Database
    const otp = await prisma.otpCode.create({
      data: { 
        email: cleanEmail, 
        codeHash, 
        expiresAt, 
        purpose, 
        ipAddress, 
        userAgent 
      }
    });

    logger.security('OTP issued', { 
      email: this._maskEmail(cleanEmail), 
      purpose, 
      ip: ipAddress,
      otpId: otp.id
    });

    // 6. Dispatch Email (replace SMS)
    // In dev without GMAIL credentials, the code is logged to console
    if (process.env.NODE_ENV === 'development' && !process.env.GMAIL_USER) {
      logger.info(`[EMAIL SIMULATOR] OTP for ${cleanEmail}: ${code}`);
    } else {
      await sendOtpEmail(cleanEmail, code, purpose);
    }

    return {
      otpId: otp.id,
      expiresIn: OTP_TTL_MINUTES * 60,
      cooldown: RESEND_COOLDOWN_SECONDS
    };
  }

  /**
   * ✅ Verify OTP by email
   */
  async verifyOtp({ email, code, purpose = 'login' }) {
    if (!code || code.length !== OTP_LENGTH) {
      throw new Error('INVALID_CODE_FORMAT');
    }

    const cleanEmail = email.toLowerCase().trim();

    // Find the latest valid, unused OTP
    const otp = await prisma.otpCode.findFirst({
      where: {
        email: cleanEmail,
        purpose,
        used: false,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!otp) {
      throw new Error('OTP_NOT_FOUND_OR_EXPIRED');
    }

    // Protection against Brute Force attempts on a single OTP
    if (otp.attempts >= MAX_ATTEMPTS) {
      await prisma.otpCode.update({
        where: { id: otp.id },
        data: { used: true }
      });
      throw new Error('TOO_MANY_ATTEMPTS');
    }

    // Compare Hash
    const valid = await bcrypt.compare(code, otp.codeHash);
    
    if (!valid) {
      await prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } }
      });
      
      logger.security('OTP verification failed', { 
        email: this._maskEmail(cleanEmail), 
        attempt: otp.attempts + 1 
      });
      throw new Error('INVALID_OTP');
    }

    // Mark as used (Atomic consumption)
    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { used: true }
    });

    logger.security('OTP verified successfully', { email: this._maskEmail(cleanEmail) });
    return true;
  }

  /**
   * 📧 Mask email for privacy in logs
   * e.g., "user@gmail.com" → "us***@gmail.com"
   */
  _maskEmail(email) {
    if (!email || !email.includes('@')) return '****';
    const [local, domain] = email.split('@');
    const maskedLocal = local.length <= 2 
      ? local[0] + '***' 
      : local.slice(0, 2) + '***';
    return `${maskedLocal}@${domain}`;
  }

  /**
   * 🧹 Cleanup Task
   */
  async cleanupExpired() {
    const result = await prisma.otpCode.deleteMany({
      where: { 
        OR: [
          { expiresAt: { lt: new Date() } },
          { used: true, createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
        ]
      }
    });
    if (result.count > 0) {
      logger.info(`[OTP] Cleaned ${result.count} stale codes.`);
    }
  }
}

module.exports = new OtpService();
