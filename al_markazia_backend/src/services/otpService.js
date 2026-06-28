// src/services/otpService.js
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const { hashBlind } = require('../utils/crypto');
const logger = require('../utils/logger');
const { addOtpToQueue, addPasswordResetToQueue } = require('../queues/emailQueue');

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_REQUESTS_PER_PERIOD = 5;

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
   * @param {string} [params.phone] - Target phone number
   * @param {string} [params.purpose='login'] - 'login' | 'register' | 'password_reset'
   * @param {string} [params.ipAddress]
   * @param {string} [params.userAgent]
   */
  async requestOtp({ email, phone, purpose = 'login', ipAddress, userAgent, metadata = {} }) {
    const cleanEmail = email ? email.toLowerCase().trim() : null;

    // 1. Rate limit per email: Global hour limit
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const where = email ? { emailHash: hashBlind(email) } : { phoneHash: hashBlind(phone) };
    where.createdAt = { gte: tenMinutesAgo };

    const recentRequests = await prisma.otpCode.count({ where });

    if (recentRequests >= MAX_REQUESTS_PER_PERIOD) {
      throw new Error('TOO_MANY_OTP_REQUESTS');
    }

    // 2. Resend Cooldown Check
    const lastOtp = await prisma.otpCode.findFirst({
      where: { 
        emailHash: email ? hashBlind(email) : undefined,
        phoneHash: phone ? hashBlind(phone) : undefined,
        purpose, 
        used: false 
      },
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
      where: { 
        emailHash: email ? hashBlind(email) : undefined,
        phoneHash: phone ? hashBlind(phone) : undefined,
        purpose, 
        used: false 
      },
      data: { used: true }
    });

    // 5. Save OTP Hash to Database
    const otp = await prisma.otpCode.create({
      data: { 
        email: cleanEmail,
        emailHash: email ? hashBlind(email) : null,
        phone,
        phoneHash: phone ? hashBlind(phone) : null,
        codeHash,
        expiresAt,
        purpose, 
        ipAddress, 
        userAgent,
        metadata: metadata || {}
      }
    });

    logger.security('OTP issued', { 
      email: this._maskEmail(cleanEmail), 
      purpose, 
      ip: ipAddress,
      otpId: otp.id
    });

    // 6. Dispatch Email (replace SMS)
    // Always log to console in development/test for convenient debugging
    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV || process.env.NODE_ENV === 'test') {
      logger.info(`[EMAIL SIMULATOR] OTP for ${cleanEmail || phone}: ${code}`);
    }

    if (process.env.NODE_ENV === 'development' && !process.env.EMAIL_USER) {
      // Skip queue, already logged above
    } else {
      if (cleanEmail) {
        if (purpose === 'password_reset') {
          await addPasswordResetToQueue(cleanEmail, code);
        } else {
          await addOtpToQueue(cleanEmail, code, purpose);
        }
      }
    }

    return {
      otpId: otp.id,
      expiresIn: OTP_TTL_MINUTES * 60,
      cooldown: RESEND_COOLDOWN_SECONDS
    };
  }

  /**
   * ✅ Verify OTP by email or phone
   */
  async verifyOtp({ email, phone, code, purpose = 'login' }) {
    if (!code || code.length !== OTP_LENGTH) {
      throw new Error('INVALID_CODE_FORMAT');
    }

    const cleanEmail = email ? email.toLowerCase().trim() : null;
    const cleanPhone = phone ? this.normalizePhone(phone) : null;

    if (!cleanEmail && !cleanPhone) {
      throw new Error('MISSING_FIELDS');
    }

    // Find the latest valid, unused OTP
    const otp = await prisma.otpCode.findFirst({
      where: {
        emailHash: cleanEmail ? hashBlind(cleanEmail) : undefined,
        phoneHash: cleanPhone ? hashBlind(cleanPhone) : undefined,
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
        email: cleanEmail ? this._maskEmail(cleanEmail) : undefined, 
        phone: cleanPhone ? '****' + cleanPhone.slice(-4) : undefined,
        attempt: otp.attempts + 1 
      });
      throw new Error('INVALID_OTP');
    }

    // Mark as used (Atomic consumption)
    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { used: true }
    });

    logger.security('OTP verified successfully', { 
      email: cleanEmail ? this._maskEmail(cleanEmail) : undefined,
      phone: cleanPhone ? '****' + cleanPhone.slice(-4) : undefined
    });
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
   * 📞 Normalize Jordanian phone number formats
   */
  normalizePhone(phone) {
    if (!phone) return null;
    let p = phone.toString().trim().replace(/\s+/g, '');
    // قبول +9627XXXXXXXX أو 009627XXXXXXXX
    if (p.startsWith('+962')) p = '0' + p.slice(4);
    if (p.startsWith('00962')) p = '0' + p.slice(5);
    // تحقق: يجب أن يبدأ بـ 07 ويكون 10 أرقام
    if (!/^07[789]\d{7}$/.test(p)) return null;
    return p;
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
