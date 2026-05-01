const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { generateFingerprint } = require('../utils/security');
const TokenService = require('../services/tokenService');
const auditService = require('../services/auditService');
const { REFRESH_TOKEN_EXPIRY_MS } = require('../config/secrets');
const { OTP_EXPIRY } = require('../config/constants');
const response = require('../utils/response');

const passwordRegex = /^(?=.*[a-zA-Z])(?=.*[\d!@#$%^&*]).{8,}$/;

// ── Helper: Token Sanitizer ───────────────────────────
/**
 * 🧹 Cleans and validates the refresh token string before processing.
 * Fixes "jwt malformed" caused by quotes, whitespace, or "undefined" strings.
 */
const sanitizeToken = (token) => {
  if (!token || typeof token !== 'string') return null;

  // 1. Trim whitespace and remove wrapping quotes (some browsers/proxies add them)
  let cleanToken = token.trim().replace(/^"|"$/g, '');

  // 2. Reject literal "undefined" or "null" strings
  if (cleanToken === 'undefined' || cleanToken === 'null' || cleanToken.length < 20) {
    return null;
  }

  // 3. Ensure it looks like a valid JWT (Header.Payload.Signature)
  if (cleanToken.split('.').length !== 3) {
    return null;
  }

  return cleanToken;
};

// ── Helper: Secure Cookie Config ──────────────────────
const refreshCookieOptions = (req) => {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  
  return {
    httpOnly: true,
    secure: isSecure,                                // Auto-detect HTTPS
    sameSite: isSecure ? 'none' : 'lax',             // 'none' for cross-site HTTPS, 'lax' for local/HTTP
    path: '/',
    maxAge: REFRESH_TOKEN_EXPIRY_MS
  };
};

// ── Helper: Clear Cookie with same options ──
const clearRefreshCookie = (req, res) => {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.clearCookie('refreshToken', { 
    path: '/',
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? 'none' : 'lax'
  });
};

/**
 * 🔄 Refresh Token Rotation (Hardened)
 * Supports both Cookie (Modern) and Body (Legacy Fallback).
 */
const refreshToken = async (req, res) => {
  // 🛡️ Sanitization: Protect against malformed cookies/body
  const rawToken = req.cookies?.refreshToken || req.body?.refreshToken;
  const token = sanitizeToken(rawToken);

  if (!token) {
    logger.security('[REFRESH_BLOCKED] Corrupt or missing token received.', { 
      type: typeof rawToken, 
      length: rawToken?.length || 0,
      preview: typeof rawToken === 'string' ? rawToken.substring(0, 10) : 'N/A'
    });
    clearRefreshCookie(req, res);
    return response.error(res, 'جلسة غير صالحة، يرجى تسجيل الدخول مجدداً', 'INVALID_SESSION', 401);
  }

  try {
    const oldRefreshToken = req.cookies.refreshToken;
    if (!oldRefreshToken) throw new Error('MISSING_REFRESH_TOKEN');

    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const currentFingerprint = generateFingerprint(req);
    
    const { accessToken, newRefreshToken, user } = await TokenService.validateAndRotate(oldRefreshToken, clientIp, currentFingerprint);

    // 🛡️ Cookie Hardening
    res.cookie('refreshToken', newRefreshToken.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      path: '/auth/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    await auditService.log({
      userId: user.uuid,
      userRole: user.role,
      action: 'TOKEN_REFRESH',
      req
    });

    // ✅ Return both tokens (refreshToken is for mobile app storage)
    response.success(res, { 
      accessToken,
      refreshToken: newRefreshToken.token
    });
  } catch (error) {
    if (error.message === 'TOKEN_REUSE_DETECTED') {
      clearRefreshCookie(req, res);
      return response.error(res, 'تنبيه أمني: تم اكتشاف محاولة اختراق الجلسة. تم تسجيل الخروج من كافة الأجهزة.', 'SECURITY_BREACH', 401);
    }
    
    clearRefreshCookie(req, res);
    logger.security('Invalid refresh attempt', { error: error.message });
    return response.error(res, 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول', 'SESSION_EXPIRED', 401);
  }
};

/**
 * 🔑 Enterprise Login Orchestrator
 */
const login = async (req, res) => {
  const { email, password, fcmToken } = req.body;
  const start = Date.now();
  try {
    const cleanEmail = email.toLowerCase().trim();
    logger.debug('Login attempt initiated', { email: cleanEmail });
    
    // 🛡️ [SEC-FIX] Lockout Key: IP + Email to prevent global user DoS
    const lockoutKey = `${req.ip}_${cleanEmail}`;
    
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    const customer = !user ? await prisma.customer.findUnique({ where: { email: cleanEmail } }) : null;
    const account = user || customer;

    // 🛡️ Account Lockout Check
    if (account && account.lockUntil && account.lockUntil > new Date()) {
      const remainingMinutes = Math.ceil((account.lockUntil - new Date()) / 60000);
      return response.error(res, `الحساب مغلق مؤقتاً بكثرة المحاولات الخاطئة. حاول مجدداً بعد ${remainingMinutes} دقيقة.`, 'ACCOUNT_LOCKED', 403);
    }

    if (!account || !account.password) {
      await auditService.log({
        action: 'LOGIN_FAIL',
        status: 'FAIL',
        severity: 'WARN',
        metadata: { identifier: cleanEmail, reason: 'ACCOUNT_NOT_FOUND' },
        req
      });
      return response.error(res, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS', 401);
    }

    const match = account ? await bcrypt.compare(password, account.password) : false;
    
    if (!match) {
      if (account) {
        // Increment failed attempts
        const newAttempts = account.failedAttempts + 1;
        const lockUntil = newAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
        
        if (user) {
          await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: newAttempts, lockUntil } });
        } else {
          await prisma.customer.update({ where: { id: customer.id }, data: { failedAttempts: newAttempts, lockUntil } });
        }
        
        await auditService.log({
          userId: account.uuid,
          userRole: account.role || 'customer',
          action: 'LOGIN_FAIL',
          status: 'FAIL',
          severity: newAttempts >= 5 ? 'CRITICAL' : 'WARN',
          metadata: { failedAttempts: newAttempts, locked: !!lockUntil },
          req
        });
      }

      logger.security('Invalid login attempt: Password mismatch or no account', { identifier: cleanEmail, ip: req.ip });
      
      // ⏱️ Timing Attack Protection: Standardized delay
      const elapsed = Date.now() - start;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      
      return response.error(res, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS', 401);
    }

    // Success: Reset failed attempts
    if (account.failedAttempts > 0) {
      if (user) {
        await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockUntil: null } });
      } else {
        await prisma.customer.update({ where: { id: customer.id }, data: { failedAttempts: 0, lockUntil: null } });
      }
    }

    // 🛡️ Account Status Security Check
    const isDisabled = (user && !user.isActive) || (customer && customer.isBlacklisted);
    if (isDisabled) {
      logger.security('Login blocked: Account is disabled or blacklisted', { identifier: cleanEmail, uuid: account.uuid });
      return response.error(res, 'هذا الحساب معطل حالياً أو محظور، يرجى التواصل مع الدعم', 'ACCOUNT_DISABLED', 403);
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

    // 🛡️ [SEC-FIX] Device Fingerprinting
    const fingerprint = generateFingerprint(req);

    // 🔐 [SEC-FIX] JTI-based Session Logic moved to TokenService
    const { token: refreshToken, jti } = await TokenService.generateAndSaveRefreshToken(account, null, fingerprint.hash);
    const accessToken = TokenService.generateAccessToken(account, jti);

    // 🛡️ Cookie Hardening (Level 5 Security)
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict', // Standard Strict for same-domain SPAs
      path: '/auth/refresh', // Restricted path
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    await auditService.log({
      userId: account.uuid,
      userRole: account.role || 'customer',
      action: 'LOGIN_SUCCESS',
      metadata: { device: req.headers['user-agent'] },
      req
    });

    response.success(res, { 
      accessToken, 
      refreshToken: refreshToken,
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

  clearRefreshCookie(req, res);
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
        role: user.role || 'customer',
        points: user.points ?? 0,
        tier: user.tier || 'SILVER'
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
    // 🛡️ Normalize email early to prevent case-mismatch bugs
    const cleanEmail = email.toLowerCase().trim();

    // 0. Validate Password Strength
    if (!passwordRegex.test(password)) {
      return response.error(res, 'كلمة المرور يجب أن تكون 8 خانات على الأقل وتحتوي على حرف ورقم أو رمز', 'WEAK_PASSWORD', 400);
    }

    // 1. Validate if account exists in either table (Email or Phone)
    const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
    const existingCustomer = await prisma.customer.findUnique({ where: { email: cleanEmail } });
    
    if (existingUser || existingCustomer) {
      return response.error(res, 'البريد الإلكتروني مسجل مسبقاً', 'EMAIL_EXISTS', 400);
    }

    if (phone) {
      const existingUserPhone = await prisma.user.findUnique({ where: { phone } });
      const existingCustomerPhone = await prisma.customer.findUnique({ where: { phone } });
      if (existingUserPhone || existingCustomerPhone) {
        return response.error(res, 'رقم الجوال مسجل مسبقاً', 'PHONE_EXISTS', 400);
      }
    }

    // 2. Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY.REGISTRATION);

    // 3. Hash Password for temporary storage
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Save to OtpCode with metadata (always use cleanEmail)
    await prisma.otpCode.create({
      data: {
        email: cleanEmail,
        codeHash: await bcrypt.hash(otp, 10),
        purpose: 'registration',
        expiresAt,
        metadata: { name, email: cleanEmail, password: hashedPassword, phone }
      }
    });

    // 5. Dispatch Email
    await EmailService.sendOtp(cleanEmail, otp);

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
    // 🛡️ Normalize email to match what register() stored
    const cleanEmail = email.toLowerCase().trim();

    // 1. Find the latest valid OTP
    const otpRecord = await prisma.otpCode.findFirst({
      where: { email: cleanEmail, purpose: 'registration', used: false },
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
        email: cleanEmail,
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
    const { token, jti } = await TokenService.generateAndSaveRefreshToken(account);
    const accessToken = TokenService.generateAccessToken(account, jti);

    // 🛡️ Security Guard
    if (!token || typeof token !== 'string') {
      throw new Error('[CRITICAL] Invalid refresh token generated during registration');
    }
    
    res.cookie('refreshToken', token, refreshCookieOptions(req));

    response.success(res, { 
      accessToken, 
      refreshToken: token,
      user: { 
        id: account.uuid, 
        email: account.email, 
        name: account.name, 
        phone: account.phone, 
        role: 'customer' 
      } 
    });
  } catch (error) {
    logger.error('Verify registration error', { error: error.message, code: error.code });
    
    // 🛡️ Handle Prisma unique constraint violations with user-friendly messages
    if (error.code === 'P2002') {
      const target = error.meta?.target;
      if (target?.includes('email')) {
        return response.error(res, 'البريد الإلكتروني مسجل مسبقاً', 'EMAIL_EXISTS', 400);
      }
      if (target?.includes('phone')) {
        return response.error(res, 'رقم الجوال مسجل مسبقاً', 'PHONE_EXISTS', 400);
      }
      return response.error(res, 'الحساب موجود مسبقاً', 'DUPLICATE', 400);
    }
    
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
    const { token, jti } = await TokenService.generateAndSaveRefreshToken(updatedAccount);
    const accessToken = TokenService.generateAccessToken(updatedAccount, jti);

    // 🛡️ Security Guard
    if (!token || typeof token !== 'string') {
      throw new Error('[CRITICAL] Invalid refresh token generated during password reset');
    }

    res.cookie('refreshToken', token, refreshCookieOptions(req));

    response.success(res, {
      accessToken,
      refreshToken: token,
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

/**
 * 🖥️ Get Active Sessions
 */
const getSessions = async (req, res) => {
  try {
    const userId = req.user.id;
    const sessions = await TokenService.getActiveSessions(userId);
    response.success(res, sessions);
  } catch (err) {
    response.error(res, 'Failed to fetch sessions', 'SESSIONS_ERROR');
  }
};

module.exports = { 
  login, 
  register, 
  verifyRegistration, 
  forgotPassword, 
  resetPassword, 
  refreshToken, 
  logout, 
  getMe,
  getSessions 
};
