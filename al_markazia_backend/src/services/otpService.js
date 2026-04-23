// src/services/otpService.js
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

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
    // 🛡️ Security: crypto.randomInt is preferred over Math.random for security codes
    return crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');
  }

  /**
   * 🚀 Request OTP (rate-limited, anti-enumeration)
   */
  async requestOtp({ phone, purpose = 'login', ipAddress, userAgent }) {
    // 1. Normalize phone (simple version, could be more complex)
    const cleanPhone = this.normalizePhone(phone);

    // 2. Rate limit per phone: Global hour limit
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentRequests = await prisma.otpCode.count({
      where: { phone: cleanPhone, createdAt: { gte: oneHourAgo } }
    });

    if (recentRequests >= MAX_REQUESTS_PER_HOUR) {
      throw new Error('TOO_MANY_OTP_REQUESTS');
    }

    // 3. Resend Cooldown Check
    const lastOtp = await prisma.otpCode.findFirst({
      where: { phone: cleanPhone, purpose, used: false },
      orderBy: { createdAt: 'desc' }
    });

    if (lastOtp) {
      const elapsed = (Date.now() - lastOtp.createdAt.getTime()) / 1000;
      if (elapsed < RESEND_COOLDOWN_SECONDS) {
        throw new Error(`RESEND_COOLDOWN:${Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed)}`);
      }
    }

    // 4. Generate Code & Hash
    const code = this._generateCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    // 5. Invalidate previous unused OTPs for this phone/purpose
    await prisma.otpCode.updateMany({
      where: { phone: cleanPhone, purpose, used: false },
      data: { used: true }
    });

    // 6. Save OTP Hash to Database
    const otp = await prisma.otpCode.create({
      data: { 
        phone: cleanPhone, 
        codeHash, 
        expiresAt, 
        purpose, 
        ipAddress, 
        userAgent 
      }
    });

    logger.security('OTP issued', { 
      phone: this._maskPhone(cleanPhone), 
      purpose, 
      ip: ipAddress,
      otpId: otp.id
    });

    // 7. Dispatch SMS
    await this._sendSms(cleanPhone, code);

    return {
      otpId: otp.id,
      expiresIn: OTP_TTL_MINUTES * 60,
      cooldown: RESEND_COOLDOWN_SECONDS
    };
  }

  /**
   * ✅ Verify OTP
   */
  async verifyOtp({ phone, code, purpose = 'login' }) {
    if (!code || code.length !== OTP_LENGTH) {
      throw new Error('INVALID_CODE_FORMAT');
    }

    const cleanPhone = this.normalizePhone(phone);

    // Find the latest valid, unused OTP
    const otp = await prisma.otpCode.findFirst({
      where: {
        phone: cleanPhone,
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
        phone: this._maskPhone(cleanPhone), 
        attempt: otp.attempts + 1 
      });
      throw new Error('INVALID_OTP');
    }

    // Mark as used (Atomic consumption)
    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { used: true }
    });

    logger.security('OTP verified successfully', { phone: this._maskPhone(cleanPhone) });
    return true;
  }

  /**
   * 📱 SMS Dispatcher
   */
  async _sendSms(phone, code) {
    if (process.env.NODE_ENV === 'development' || !process.env.SMS_PROVIDER) {
      logger.info(`[SMS SIMULATOR] OTP for ${phone}: ${code}`);
      return;
    }

    const message = `رمز التحقق الخاص بك في المركزية: ${code}\nصالح لـ ${OTP_TTL_MINUTES} دقائق.`;

    try {
      if (process.env.SMS_PROVIDER === 'twilio') {
        const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await twilio.messages.create({
          body: message,
          from: process.env.TWILIO_FROM_NUMBER,
          to: phone
        });
      }
      // Add other providers here (Unifonic, etc.)
    } catch (error) {
      logger.error('SMS Dispatch Failed', { error: error.message, phone });
      // In production, we might want to log this but not necessarily block the user if it's a dev env
      if (process.env.NODE_ENV === 'production') throw new Error('SMS_SEND_FAILED');
    }
  }

  normalizePhone(phone) {
    if (!phone) return '';
    // Basic normalization: remove non-digits, handle leading 0 for Jordan
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0') && cleaned.length === 10) {
      cleaned = '962' + cleaned.substring(1);
    }
    if (!cleaned.startsWith('+') && cleaned.length > 5) {
      cleaned = '+' + cleaned;
    }
    return cleaned;
  }

  _maskPhone(phone) {
    if (!phone || phone.length < 4) return '****';
    return phone.slice(0, 4) + '****' + phone.slice(-2);
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
