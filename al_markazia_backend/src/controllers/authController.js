const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const TokenService = require('../services/tokenService');
const { REFRESH_TOKEN_EXPIRY_MS } = require('../config/secrets');
const response = require('../utils/response');

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
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      logger.security('Invalid login attempt: User not found', { identifier: email, ip: req.ip });
      return response.error(res, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS', 401);
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      logger.security('Invalid login attempt: Password mismatch', { identifier: email, ip: req.ip });
      return response.error(res, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS', 401);
    }

    // --- 📡 Smart FCM Token Sync ---
    if (fcmToken && fcmToken !== user.fcmToken) {
      await prisma.user.update({
        where: { id: user.id },
        data: { fcmToken }
      });
      logger.info('Admin FCM Token updated', { userId: user.id });
    }

    // --- Enterprise Identity Transition ---
    const accessToken = TokenService.generateAccessToken(user);
    const refreshToken = await TokenService.generateAndSaveRefreshToken(user);
    
    // ✅ Set Secure Cookie
    res.cookie('refreshToken', refreshToken, refreshCookieOptions(req));

    logger.security('Valid login', { 
      role: user.role,
      uuid: user.uuid, 
      ip: req.ip 
    });

    response.success(res, { 
      accessToken, 
      user: { 
        id: user.uuid,
        email: user.email, 
        name: user.name,
        phone: user.phone,
        role: user.role 
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
    // 1. Validate if user exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return response.error(res, 'البريد الإلكتروني مسجل مسبقاً', 'EMAIL_EXISTS', 400);
    }

    // 2. Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

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

    // 3. Extract Metadata & Create User
    const { name, password, phone } = otpRecord.metadata;
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password,
        phone,
        role: 'customer'
      }
    });

    // 4. Mark OTP as used
    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { used: true }
    });

    // 5. Generate Session
    const accessToken = TokenService.generateAccessToken(user);
    const refreshToken = await TokenService.generateAndSaveRefreshToken(user);
    
    res.cookie('refreshToken', refreshToken, refreshCookieOptions(req));

    response.success(res, { 
      accessToken, 
      user: { id: user.uuid, email: user.email, name: user.name, phone: user.phone, role: user.role } 
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
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });

    // 🛡️ Anti-enumeration: Always return 200 even if user doesn't exist
    if (!user) {
      logger.warn('Forgot password attempt for non-existent user', { email: cleanEmail });
      return response.success(res, { message: 'إذا كان البريد مسجلاً، ستصلك رسالة قريباً' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    await prisma.otpCode.create({
      data: {
        email: cleanEmail,
        codeHash: await bcrypt.hash(otp, 10),
        purpose: 'password_reset',
        expiresAt
      }
    });

    await EmailService.sendOtp(cleanEmail, otp);
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
    const user = await prisma.user.update({
      where: { email: cleanEmail },
      data: { password: hashedPassword }
    });

    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { used: true }
    });

    // 🚀 Auto-login after successful reset
    const accessToken = TokenService.generateAccessToken(user);
    const refreshToken = await TokenService.generateAndSaveRefreshToken(user);
    res.cookie('refreshToken', refreshToken, refreshCookieOptions(req));

    response.success(res, {
      accessToken,
      user: { id: user.uuid, email: user.email, name: user.name, phone: user.phone, role: user.role }
    });
  } catch (error) {
    logger.error('Reset password error', { error: error.message });
    response.error(res, 'حدث خطأ أثناء تغيير كلمة المرور', 'SERVER_ERROR', 500);
  }
};

module.exports = { login, register, verifyRegistration, forgotPassword, resetPassword, refreshToken, logout, getMe };
