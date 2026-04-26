const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const TokenService = require('../services/tokenService');
const { REFRESH_TOKEN_EXPIRY_MS } = require('../config/secrets');
const { OTP_EXPIRY } = require('../config/constants');
const response = require('../utils/response');

const passwordRegex = /^(?=.*[a-zA-Z])(?=.*[\d!@#$%^&*]).{8,}$/;

// ── Helper: Secure Cookie Config ──────────────────────
const refreshCookieOptions = (req) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',  // HTTPS only in production
  sameSite: 'lax',                                 // Better compatibility for local dev/cross-origin
  path: '/',                                       // Global scope for easier cross-origin handshake
  maxAge: REFRESH_TOKEN_EXPIRY_MS
});

/**
 * 🔄 Refresh Token Rotation (Hardened)
 * Supports both Cookie (Modern) and Body (Legacy Fallback).
 */
const refreshToken = async (req, res) => {
  // 🛡️ Backward Compatible: Check cookie first, then body
  const token = req.cookies?.refreshToken || req.body?.refreshToken;

  if (!token) {
    return response.error(res, 'Refresh token is required', 'MISSING_TOKEN', 401);
  }

  try {
    // 🛡️ Secure Rotation & Abuse Detection
    const { accessToken, newRefreshToken, user } = await TokenService.validateAndRotate(token);
    
    // ✅ Set Secure Cookie
    res.cookie('refreshToken', newRefreshToken, refreshCookieOptions(req));

    // ✅ Return only accessToken (refreshToken is in cookie)
    response.success(res, { 
      accessToken
    });
  } catch (error) {
    if (error.message === 'TOKEN_REUSE_DETECTED') {
      res.clearCookie('refreshToken', { path: '/' });
      return response.error(res, 'تنبيه أمني: تم اكتشاف محاولة اختراق الجلسة. تم تسجيل الخروج من كافة الأجهزة.', 'SECURITY_BREACH', 401);
    }
    
    res.clearCookie('refreshToken', { path: '/' });
    logger.security('Invalid refresh attempt', { error: error.message });
    return response.error(res, 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول', 'SESSION_EXPIRED', 401);
  }
};

/**
 * 🔑 Enterprise Login Orchestrator
 */
const login = async (req, res) => {
  const { email, password, fcmToken } = req.body;
  try {
    const cleanEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    const customer = !user ? await prisma.customer.findUnique({ where: { email: cleanEmail } }) : null;
    const account = user || customer;

    if (!account || !account.password) {
      logger.security('Invalid login attempt: Account not found or no password set', { identifier: cleanEmail, ip: req.ip });
      return response.error(res, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS', 401);
    }

    const match = await bcrypt.compare(password, account.password);
    if (!match) {
      logger.security('Invalid login attempt: Password mismatch', { identifier: cleanEmail, ip: req.ip });
      return response.error(res, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS', 401);
    }

    // --- 📡 Smart FCM Token Sync ---
    if (fcmToken && fcmToken !== account.fcmToken) {
      if (user) {
        await prisma.user.update({ where: { id: user.id }, data: { fcmToken } });
      } else {
        await prisma.customer.update({ where: { id: customer.id }, data: { fcmToken } });
      }
      logger.info('FCM Token updated', { accountId: account.uuid });
    }

    // --- Enterprise Identity Transition ---
    const accessToken = TokenService.generateAccessToken(account);
    const refreshToken = await TokenService.generateAndSaveRefreshToken(account);
    
    // ✅ Set Secure Cookie
    res.cookie('refreshToken', refreshToken, refreshCookieOptions(req));

    logger.security('Valid login', { 
      role: account.role || 'customer',
      uuid: account.uuid, 
      ip: req.ip 
    });

    response.success(res, { 
      accessToken, 
      user: { 
        id: account.uuid,
        email: account.email, 
        name: account.name,
        phone: account.phone,
        role: account.role || 'customer' 
      } 
    });
  } catch (error) {
    logger.error('Login error', { error: error.message });
    response.error(res, 'Internal Server Error', 'SERVER_ERROR', 500);
  }
};

/**
 * 🚪 Secure Logout (Revoke & Clear)
 */
const logout = async (req, res) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  
  if (token) {
    await TokenService.revokeToken(token);
  }

  res.clearCookie('refreshToken', { path: '/' });
  return res.json({ success: true, message: 'Logged out successfully' });
};

/**
 * 👤 Identity Bootstrap (Who am I?)
 */
const getMe = async (req, res) => {
  try {
    let user = null;
    if (req.user.role === 'admin' || req.user.role === 'super_admin') {
      user = await prisma.user.findUnique({ where: { uuid: req.user.id } });
    } else {
      user = await prisma.customer.findUnique({ where: { uuid: req.user.id } });
    }

    if (!user) {
      return response.error(res, 'User not found', 'USER_NOT_FOUND', 404);
    }

    res.json({ 
      success: true, 
      data: {
        id: user.uuid,
        email: user.email || null,
        phone: user.phone || null,
        name: user.name || null,
        role: user.role || 'customer'
      } 
    });
  } catch (err) {
    response.error(res, 'Server error', 'SERVER_ERROR', 500);
  }
};

const EmailService = require('../services/emailService');

/**
 * 📝 Phase 1: Registration Request (Send OTP)
 */
const register = async (req, res) => {
  const { name, email, password, phone } = req.body;
  try {
    // 0. Validate Password Strength
    if (!passwordRegex.test(password)) {
      return response.error(res, 'كلمة المرور يجب أن تكون 8 خانات على الأقل وتحتوي على حرف ورقم أو رمز', 'WEAK_PASSWORD', 400);
    }

    // 1. Validate if account exists in either table
    const existingUser = await prisma.user.findUnique({ where: { email } });
    const existingCustomer = await prisma.customer.findUnique({ where: { email } });
    
    if (existingUser || existingCustomer) {
      return response.error(res, 'البريد الإلكتروني مسجل مسبقاً', 'EMAIL_EXISTS', 400);
    }

    // 2. Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY.REGISTRATION);

    // 3. Hash Password for temporary storage
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Save to OtpCode with metadata
    await prisma.otpCode.create({
      data: {
        email,
        codeHash: await bcrypt.hash(otp, 10),
        purpose: 'registration',
        expiresAt,
        metadata: { name, email, password: hashedPassword, phone }
      }
    });

    // 5. Dispatch Email
    await EmailService.sendOtp(email, otp);

    response.success(res, { 
      message: 'تم إرسال كود التحقق إلى بريدك الإلكتروني'
    });
  } catch (error) {
    logger.error('Registration OTP error', { error: error.message });
    response.error(res, 'حدث خطأ أثناء إرسال كود التحقق', 'SERVER_ERROR', 500);
  }
};

/**
 * ✅ Phase 2: Verify Registration OTP & Create User
 */
const verifyRegistration = async (req, res) => {
  const { email, code } = req.body;
  try {
    // 1. Find the latest valid OTP
    const otpRecord = await prisma.otpCode.findFirst({
      where: { email, purpose: 'registration', used: false },
      orderBy: { createdAt: 'desc' }
    });

    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      return response.error(res, 'كود التحقق غير صحيح أو منتهي الصلاحية', 'INVALID_OTP', 400);
    }

    // 2. Verify Code
    const isMatch = await bcrypt.compare(code, otpRecord.codeHash);
    if (!isMatch) {
      return response.error(res, 'كود التحقق غير صحيح', 'INVALID_OTP', 400);
    }

    // 3. Extract Metadata & Create Customer
    const { name, password, phone } = otpRecord.metadata;
    const account = await prisma.customer.create({
      data: {
        name,
        email,
        password,
        phone
      }
    });

    // 4. Mark OTP as used
    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { used: true }
    });

    // 5. Generate Session
    const accessToken = TokenService.generateAccessToken(account);
    const refreshToken = await TokenService.generateAndSaveRefreshToken(account);
    
    res.cookie('refreshToken', refreshToken, refreshCookieOptions(req));

    response.success(res, { 
      accessToken, 
      user: { 
        id: account.uuid, 
        email: account.email, 
        name: account.name, 
        phone: account.phone, 
        role: 'customer' 
      } 
    });
  } catch (error) {
    logger.error('Verify registration error', { error: error.message });
    response.error(res, 'حدث خطأ أثناء تفعيل الحساب', 'SERVER_ERROR', 500);
  }
};

/**
 * 🔑 Phase 1: Forgot Password (Send OTP)
 */
const forgotPassword = async (req, res) => {
  const { email } = req.body;
  const cleanEmail = email.toLowerCase().trim();

  try {
    // 🛡️ Search both User (Admin) and Customer tables
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    const customer = !user ? await prisma.customer.findUnique({ where: { email: cleanEmail } }) : null;

    // 🛡️ Anti-enumeration: Always return 200 even if neither exists
    if (!user && !customer) {
      logger.warn('Forgot password attempt for non-existent email', { email: cleanEmail });
      return response.success(res, { message: 'إذا كان البريد مسجلاً، ستصلك رسالة قريباً' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY.PASSWORD_RESET);

    await prisma.otpCode.create({
      data: {
        email: cleanEmail,
        codeHash: await bcrypt.hash(otp, 10),
        purpose: 'password_reset',
        expiresAt
      }
    });

    await EmailService.sendPasswordResetOtp(cleanEmail, otp);
    response.success(res, { message: 'إذا كان البريد مسجلاً، ستصلك رسالة قريباً' });
  } catch (error) {
    logger.error('Forgot password error', { error: error.message });
    response.error(res, 'حدث خطأ غير متوقع', 'SERVER_ERROR', 500);
  }
};

/**
 * 🔑 Phase 2: Reset Password (Verify OTP + Update)
 */
const resetPassword = async (req, res) => {
    const { email, code, newPassword } = req.body;
  const cleanEmail = email.toLowerCase().trim();

  try {
    // 0. Validate Password Strength
    if (!passwordRegex.test(newPassword)) {
      return response.error(res, 'كلمة المرور يجب أن تكون 8 خانات على الأقل وتحتوي على حرف ورقم أو رمز', 'WEAK_PASSWORD', 400);
    }

    const otpRecord = await prisma.otpCode.findFirst({
      where: { email: cleanEmail, purpose: 'password_reset', used: false },
      orderBy: { createdAt: 'desc' }
    });

    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      return response.error(res, 'كود التحقق غير صحيح أو منتهي الصلاحية', 'INVALID_OTP', 400);
    }

    const isMatch = await bcrypt.compare(code, otpRecord.codeHash);
    if (!isMatch) {
      return response.error(res, 'كود التحقق غير صحيح', 'INVALID_OTP', 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // ✅ Check user type and update accordingly
    let account = await prisma.user.findUnique({ where: { email: cleanEmail } });
    let isUser = true;

    if (!account) {
      account = await prisma.customer.findUnique({ where: { email: cleanEmail } });
      isUser = false;
    }

    if (!account) {
      return response.error(res, 'الحساب غير موجود', 'USER_NOT_FOUND', 404);
    }

    let updatedAccount;
    await prisma.$transaction(async (tx) => {
      if (isUser) {
        updatedAccount = await tx.user.update({
          where: { email: cleanEmail },
          data: { password: hashedPassword }
        });
      } else {
        updatedAccount = await tx.customer.update({
          where: { email: cleanEmail },
          data: { password: hashedPassword }
        });
      }

      // 🔥 Revoke ALL old sessions (Security Best Practice)
      await tx.refreshToken.deleteMany({
        where: { userId: updatedAccount.uuid }
      });

      // 📝 Audit Log
      await tx.systemAuditLog.create({
        data: {
          userId: updatedAccount.uuid,
          userRole: isUser ? updatedAccount.role : 'customer',
          action: 'PASSWORD_RESET',
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          metadata: { email: cleanEmail }
        }
      });
    });

    logger.security('Password reset — all sessions revoked', { email: cleanEmail, uuid: updatedAccount.uuid });

    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { used: true }
    });

    // 🚀 Auto-login after successful reset
    const accessToken = TokenService.generateAccessToken(updatedAccount);
    const refreshToken = await TokenService.generateAndSaveRefreshToken(updatedAccount);
    res.cookie('refreshToken', refreshToken, refreshCookieOptions(req));

    response.success(res, {
      accessToken,
      user: { 
        id: updatedAccount.uuid, 
        email: updatedAccount.email, 
        name: updatedAccount.name, 
        phone: updatedAccount.phone, 
        role: updatedAccount.role || 'customer' 
      }
    });
  } catch (error) {
    logger.error('Reset password error', { error: error.message });
    response.error(res, 'حدث خطأ أثناء تغيير كلمة المرور', 'SERVER_ERROR', 500);
  }
};

module.exports = { login, register, verifyRegistration, forgotPassword, resetPassword, refreshToken, logout, getMe };
