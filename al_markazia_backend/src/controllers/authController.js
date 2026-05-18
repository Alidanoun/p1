const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { generateFingerprint, validatePasswordStrength } = require('../utils/security');
const { encrypt, decrypt, hashBlind } = require('../utils/crypto');
const TokenService = require('../services/tokenService');
const auditService = require('../services/auditService');
const { REFRESH_TOKEN_EXPIRY_MS, ACCESS_TOKEN_EXPIRY_MS, BCRYPT_ROUNDS } = require('../config/secrets');
const { OTP_EXPIRY } = require('../config/constants');
const response = require('../utils/response');

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
const getCookiePolicy = (req) => {
  const isProd = process.env.NODE_ENV === 'production';
  // 🛡️ [SEC-FIX] Dynamic sameSite policy: 'lax' for dev stability, 'strict' for prod security
  const sameSite = isProd ? 'strict' : 'lax';
  
  // If sameSite is 'none', secure attribute MUST be true by browser spec
  // In development (lax), secure can be false on HTTP. In production (strict), secure is mandatory.
  const secure = isProd || req.secure || req.headers['x-forwarded-proto'] === 'https';
  
  return { sameSite, secure };
};

const refreshCookieOptions = (req) => {
  const policy = getCookiePolicy(req);
  return {
    httpOnly: true,
    secure: policy.secure,
    sameSite: policy.sameSite,
    path: '/',
    maxAge: REFRESH_TOKEN_EXPIRY_MS
  };
};

const accessCookieOptions = (req) => {
  const policy = getCookiePolicy(req);
  return {
    httpOnly: true,
    secure: policy.secure,
    sameSite: policy.sameSite,
    path: '/',
    maxAge: ACCESS_TOKEN_EXPIRY_MS
  };
};

// ── Helper: Clear Auth Cookies ──
const clearAuthCookies = (req, res) => {
  const refOpts = refreshCookieOptions(req);
  delete refOpts.maxAge;
  res.clearCookie('refreshToken', refOpts);

  const accOpts = accessCookieOptions(req);
  delete accOpts.maxAge;
  res.clearCookie('accessToken', accOpts);
};


/**
 * 🔄 Refresh Token Rotation (Hardened)
 * Supports both Cookie (Modern) and Body (Legacy Fallback).
 */
const refreshToken = async (req, res) => {
  // 🛡️ Sanitization: Protect against malformed cookies/body
  const rawToken = req.cookies?.refreshToken || req.body?.refreshToken;
  const token = sanitizeToken(rawToken);

  logger.debug('[Auth] Refresh token processing', { 
    source: req.cookies?.refreshToken ? 'cookie' : (req.body?.refreshToken ? 'body' : 'none'),
    isSanitized: !!token,
    rawLength: rawToken?.length
  });

  if (!token) {
    logger.security('[REFRESH_BLOCKED] Corrupt or missing token received.', { 
      type: typeof rawToken, 
      length: rawToken?.length || 0,
      preview: typeof rawToken === 'string' ? rawToken.substring(0, 10) : 'N/A'
    });
    clearAuthCookies(req, res);
    return response.error(res, 'جلسة غير صالحة، يرجى تسجيل الدخول مجدداً', 'INVALID_SESSION', 401);
  }

  try {
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const currentFingerprint = generateFingerprint(req);
    
    logger.debug('[Auth] Invoking TokenService.validateAndRotate', { clientIp });
    const { accessToken, newRefreshToken, user } = await TokenService.validateAndRotate(token, clientIp, currentFingerprint);

    // 🛡️ Cookie Hardening (Dual HttpOnly Cookies)
    res.cookie('refreshToken', newRefreshToken.token, refreshCookieOptions(req));
    res.cookie('accessToken', accessToken, accessCookieOptions(req));

    await auditService.log({
      userId: user.uuid,
      userRole: user.role,
      action: 'TOKEN_REFRESH',
      req
    });

    response.success(res, { 
      accessToken,
      refreshToken: newRefreshToken.token
    });
  } catch (error) {
    logger.warn('[Auth] Refresh failed', { error: error.message, stack: error.stack });
    clearAuthCookies(req, res);

    if (error.message === 'TOKEN_REUSE_DETECTED' || error.message === 'SECURITY_BREACH') {
      return response.error(res, 'تنبيه أمني: تم اكتشاف محاولة اختراق الجلسة. تم تسجيل الخروج من كافة الأجهزة.', 'SECURITY_BREACH', 401);
    }

    if (error.message === 'TOO_MANY_REFRESH_ATTEMPTS') {
      return response.error(res, 'محاولات تحديث كثيرة جداً، يرجى الانتظار دقيقة قبل المحاولة مجدداً', 'RATE_LIMIT_EXCEEDED', 429);
    }

    if (error.message === 'ACCOUNT_DISABLED_OR_BLOCKED') {
      return response.error(res, 'تم إيقاف حسابك، يرجى التواصل مع الإدارة', 'ACCOUNT_DISABLED', 403);
    }
    
    logger.security('Invalid refresh attempt', { error: error.message });
    return response.error(res, 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول', 'SESSION_EXPIRED', 401);
  }
};

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Authenticate user and get tokens
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: admin@almarkazia.com }
 *               password: { type: string, format: password, example: '123456' }
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Account locked or disabled
 */
/**
 * 🔑 Enterprise Login Orchestrator
 */
const login = async (req, res) => {
  const { email, password, fcmToken } = req.body;
  const start = Date.now();

  try {
    const cleanEmail = email.toLowerCase().trim();
    const cleanPassword = typeof password === 'string' ? password.trim() : password;

    // Phase 1: High-Performance Search (Hashed Email)
    const hashedEmail = hashBlind(cleanEmail);
    const isDebug = process.env.AUTH_DEBUG === 'true';

    let user = await prisma.user.findUnique({ 
      where: { emailHash: hashedEmail },
      include: { branch: true }
    });

    let userFoundByFallback = false;

    // Phase 2: Compatibility Fallback (Plain Email - handles seed/legacy data)
    if (!user) {
      user = await prisma.user.findFirst({
        where: { email: cleanEmail },
        include: { branch: true }
      });
      if (user) userFoundByFallback = true;
    }

    // 🏥 [Auto-Heal] Synchronize emailHash if mismatch detected
    if (user && user.emailHash !== hashedEmail) {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailHash: hashedEmail }
      });
      if (isDebug) console.log(`[Auth] Auto-healed emailHash for admin user: ${cleanEmail}`);
    }

    let customer = null;
    let customerFoundByFallback = false;
    if (!user) {
      customer = await prisma.customer.findUnique({ 
        where: { emailHash: hashedEmail } 
      });
      if (!customer) {
        customer = await prisma.customer.findFirst({
          where: { email: cleanEmail }
        });
        if (customer) customerFoundByFallback = true;
      }

      // 🏥 [Auto-Heal] Synchronize emailHash for customer
      if (customer && customer.emailHash !== hashedEmail) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: { emailHash: hashedEmail }
        });
        if (isDebug) console.log(`[Auth] Auto-healed emailHash for customer: ${cleanEmail}`);
      }
    }

    if (isDebug) {
      console.log(`[Auth] Login attempt for ${cleanEmail}:`, {
        found: !!(user || customer),
        type: user ? 'user' : (customer ? 'customer' : 'none'),
        fallback: userFoundByFallback || customerFoundByFallback,
        hashMatch: (user || customer)?.emailHash === hashedEmail
      });
    }

    const account = user || customer;

    // 🛡️ [SEC] Multi-Factor/Lockout Guard
    if (account && account.lockUntil && account.lockUntil > new Date()) {
      const remainingMinutes = Math.ceil((account.lockUntil - new Date()) / 60000);
      return response.error(res, `الحساب مغلق مؤقتاً. حاول مجدداً بعد ${remainingMinutes} دقيقة.`, 'ACCOUNT_LOCKED', 403);
    }

    // ⚙️ Load System Config with Safe Fallbacks
    const configService = require('../services/configService');
    const systemConfig = await configService.getFullConfig();
    const { maxLoginAttempts, lockDurationMinutes, timingDelayMs } = systemConfig.security;

    // 🛡️ [SEC-FIX] Unified Timing Attack Guard
    // Apply delay for BOTH "account not found" and "password mismatch"
    const applySecurityDelay = async () => {
      const elapsed = Date.now() - start;
      if (elapsed < timingDelayMs) {
        await new Promise(r => setTimeout(r, timingDelayMs - elapsed));
      }
    };

    if (!account || !account.password) {
      await applySecurityDelay();
      return response.error(res, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS', 401);
    }

    // 🔐 Password Verification
    const match = await bcrypt.compare(cleanPassword, account.password);
    
    if (!match) {
      const newAttempts = (account.failedAttempts || 0) + 1;
      const lockUntil = newAttempts >= maxLoginAttempts 
        ? new Date(Date.now() + lockDurationMinutes * 60 * 1000) 
        : null;
      
      const table = user ? prisma.user : prisma.customer;
      await table.update({ where: { id: account.id }, data: { failedAttempts: newAttempts, lockUntil } });

      await auditService.log({
        userId: account.uuid,
        userRole: account.role || 'customer',
        action: 'LOGIN_FAIL',
        status: 'FAIL',
        severity: newAttempts >= maxLoginAttempts ? 'CRITICAL' : 'WARN',
        req
      });

      await applySecurityDelay();
      return response.error(res, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS', 401);
    }

    // ✅ Success Path
    const table = user ? prisma.user : prisma.customer;
    await table.update({ where: { id: account.id }, data: { failedAttempts: 0, lockUntil: null } });

    // 🛡️ Status Check
    const isDisabled = (user && !user.isActive) || (customer && customer.isBlacklisted);
    if (isDisabled) {
      return response.error(res, 'هذا الحساب محظور حالياً، يرجى التواصل مع الدعم', 'ACCOUNT_DISABLED', 403);
    }

    // 📱 FCM Token Sync
    if (fcmToken) {
      await table.update({ where: { id: account.id }, data: { fcmToken: encrypt(fcmToken) } }).catch(() => {});
    }

    // 🔐 Session Generation
    const fingerprint = generateFingerprint(req);
    const { token: refreshToken, jti } = await TokenService.generateAndSaveRefreshToken(account, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      fingerprint: fingerprint.hash
    });
    const accessToken = TokenService.generateAccessToken(account, jti);

    // 🍪 Secure Cookies
    res.cookie('refreshToken', refreshToken, refreshCookieOptions(req));
    res.cookie('accessToken', accessToken, accessCookieOptions(req));

    await auditService.log({ userId: account.uuid, action: 'LOGIN_SUCCESS', req });

    return response.success(res, { 
      accessToken, 
      user: { 
        id: account.uuid,
        email: decrypt(account.email), 
        name: decrypt(account.name),
        role: account.role || 'customer',
        branchId: account.branchId || null
      } 
    });

  } catch (error) {
    logger.error('Login error', { error: error.message, stack: error.stack });
    return response.error(res, 'حدث خطأ في النظام', 'SERVER_ERROR', 500);
  }
};

/**
 * 🚪 Secure Logout (Revoke & Clear)
 */
const logout = async (req, res) => {
  const jti = req.user?.jti;
  if (jti) {
    const tokenBlacklistService = require('../services/tokenBlacklistService');
    await tokenBlacklistService.blacklist(jti, req.user.id, 'LOGOUT').catch(() => {});
  }

  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  
  if (token) {
    await TokenService.revokeToken(token);
  }

  clearAuthCookies(req, res);
  return res.json({ success: true, message: 'Logged out successfully' });
};

/**
 * 👤 Identity Bootstrap (Who am I?)
 */
const getMe = async (req, res) => {
  try {
    let user = null;
    const isAdminRole = ['admin', 'branch_manager', 'manager'].includes(req.user.role);
    if (isAdminRole) {
      user = await prisma.user.findUnique({ 
        where: { uuid: req.user.id },
        include: { branch: true }
      });
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
        email: decrypt(user.email) || null,
        phone: decrypt(user.phone) || null,
        name: decrypt(user.name) || null,
        role: user.role || 'customer',
        branchId: user.branchId || null,
        branchName: user.branch?.name || null,
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
  const { name, email, password, phone, fcmToken } = req.body;
  try {
    // 🛡️ Normalize email early to prevent case-mismatch bugs
    const cleanEmail = email.toLowerCase().trim();

    // 0. Validate Password Strength
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.isValid) {
      return response.error(res, passwordValidation.message, 'WEAK_PASSWORD', 400);
    }

    // 1. Validate if account exists in either table (Email or Phone)
    const emailHash = hashBlind(cleanEmail);
    const existingUser = await prisma.user.findUnique({ where: { emailHash } });
    const existingCustomer = await prisma.customer.findUnique({ where: { emailHash } });
    
    if (existingUser || existingCustomer) {
      return response.error(res, 'البريد الإلكتروني مسجل مسبقاً', 'EMAIL_EXISTS', 400);
    }

    if (phone) {
      const phoneHash = hashBlind(phone);
      const existingUserPhone = await prisma.user.findUnique({ where: { phoneHash } });
      const existingCustomerPhone = await prisma.customer.findUnique({ where: { phoneHash } });
      if (existingUserPhone || existingCustomerPhone) {
        return response.error(res, 'رقم الجوال مسجل مسبقاً', 'PHONE_EXISTS', 400);
      }
    }

    const OtpService = require('../services/otpService');
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await OtpService.requestOtp({
      email: cleanEmail,
      purpose: 'registration',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { 
        name, 
        email: cleanEmail, 
        password: hashedPassword, 
        phone,
        fcmToken 
      }
    });

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
      where: { emailHash: hashBlind(cleanEmail), purpose: 'registration', used: false },
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
        email: encrypt(cleanEmail),
        emailHash: hashBlind(cleanEmail),
        password,
        phone: phone ? encrypt(phone) : null,
        phoneHash: phone ? hashBlind(phone) : null,
        fcmToken: otpRecord.metadata.fcmToken ? encrypt(otpRecord.metadata.fcmToken) : null
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
    res.cookie('accessToken', accessToken, accessCookieOptions(req));

    response.success(res, { 
      accessToken, 
      refreshToken: token,
      user: { 
        id: account.uuid, 
        email: decrypt(account.email), 
        name: decrypt(account.name), 
        phone: decrypt(account.phone), 
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
    // 🛡️ Search both User (Admin) and Customer tables using hashes
    const targetHash = hashBlind(cleanEmail);
    const user = await prisma.user.findUnique({ where: { emailHash: targetHash } });
    const customer = !user ? await prisma.customer.findUnique({ where: { emailHash: targetHash } }) : null;

    // 🛡️ Anti-enumeration: Always return 200 even if neither exists
    if (!user && !customer) {
      logger.warn('Forgot password attempt for non-existent email', { email: cleanEmail });
      return response.success(res, { message: 'إذا كان البريد مسجلاً، ستصلك رسالة قريباً' });
    }

    const OtpService = require('../services/otpService');
    await OtpService.requestOtp({
      email: cleanEmail,
      purpose: 'password_reset',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

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
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.isValid) {
      return response.error(res, passwordValidation.message, 'WEAK_PASSWORD', 400);
    }

    const otpRecord = await prisma.otpCode.findFirst({
      where: { emailHash: hashBlind(cleanEmail), purpose: 'password_reset', used: false },
      orderBy: { createdAt: 'desc' }
    });

    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      return response.error(res, 'كود التحقق غير صحيح أو منتهي الصلاحية', 'INVALID_OTP', 400);
    }

    const isMatch = await bcrypt.compare(code, otpRecord.codeHash);
    if (!isMatch) {
      return response.error(res, 'كود التحقق غير صحيح', 'INVALID_OTP', 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    
    // ✅ Check user type and update accordingly
    const targetHash = hashBlind(cleanEmail);
    let account = await prisma.user.findUnique({ where: { emailHash: targetHash } });
    let isUser = true;

    if (!account) {
      account = await prisma.customer.findUnique({ where: { emailHash: targetHash } });
      isUser = false;
    }

    if (!account) {
      return response.error(res, 'الحساب غير موجود', 'USER_NOT_FOUND', 404);
    }

    let updatedAccount;
    await prisma.$transaction(async (tx) => {
      if (isUser) {
        updatedAccount = await tx.user.update({
          where: { emailHash: targetHash },
          data: { 
            password: hashedPassword, 
            failedAttempts: 0, 
            lockUntil: null,
            authVersion: { increment: 1 } // 🔥 Invalidate all old sessions
          }
        });
      } else {
        updatedAccount = await tx.customer.update({
          where: { emailHash: targetHash },
          data: { 
            password: hashedPassword, 
            failedAttempts: 0, 
            lockUntil: null,
            authVersion: { increment: 1 } // 🔥 Invalidate all old sessions
          }
        });
      }

      // 🔥 Revoke old refresh tokens in DB
      await tx.refreshToken.updateMany({
        where: { userId: updatedAccount.uuid },
        data: { isRevoked: true }
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

    // 🔥 Blacklist all old user sessions in Redis immediately due to password change
    try {
      const tokenBlacklistService = require('../services/tokenBlacklistService');
      await tokenBlacklistService.blacklistUserSessions(updatedAccount.uuid, 'PASSWORD_CHANGED');
    } catch (blacklistErr) {
      logger.warn('[Auth] Token session blacklisting failed on password reset', { error: blacklistErr.message });
    }

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
    res.cookie('accessToken', accessToken, accessCookieOptions(req));

    response.success(res, {
      accessToken,
      refreshToken: token,
      user: { 
        id: updatedAccount.uuid, 
        email: decrypt(updatedAccount.email), 
        name: decrypt(updatedAccount.name), 
        phone: decrypt(updatedAccount.phone), 
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
