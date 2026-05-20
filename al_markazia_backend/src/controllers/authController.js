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
const redis = require('../lib/redis');

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
  const sameSite = isProd ? 'strict' : 'lax';
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

// ── Helper: Hybrid Token Deliverer ────────────────────
const sendHybridTokens = (req, res, account, accessToken, refreshTokenStr, extraData = {}) => {
  res.cookie('refreshToken', refreshTokenStr, refreshCookieOptions(req));
  res.cookie('accessToken', accessToken, accessCookieOptions(req));

  const clientType = (req.headers['x-client-type'] || '').toLowerCase();
  const userAgent = (req.headers['user-agent'] || '').toLowerCase();
  const isMobile = clientType === 'app' || clientType === 'mobile' ||
                   /flutter|dart|okhttp|afnetworking|alamofire/.test(userAgent);

  const baseUser = {
    id: account.uuid,
    email: account.email ? decrypt(account.email) : null,
    name: account.name ? decrypt(account.name) : null,
    role: account.role || 'customer',
    branchId: account.branchId || null,
    branchName: account.branch?.name || null,
    ...extraData
  };

  if (isMobile) {
    return response.success(res, {
      accessToken,
      refreshToken: refreshTokenStr,
      user: baseUser
    });
  }

  return response.success(res, {
    accessToken,
    user: baseUser
  });
};


/**
 * 🔄 Refresh Token Rotation (Hybrid Standard)
 */
const refreshToken = async (req, res) => {
  const rawToken = req.cookies?.refreshToken || req.body?.refreshToken;
  const token = sanitizeToken(rawToken);

  if (req.cookies?.refreshToken) {
    const xsrfHeader = req.headers['x-xsrf-token'];
    const xsrfCookie = req.cookies['XSRF-TOKEN'];
    if (!xsrfHeader || !xsrfCookie || xsrfHeader !== xsrfCookie) {
      logger.security('[CSRF_BLOCKED] Missing or mismatched X-XSRF-TOKEN header during cookie-based token refresh', {
        ip: req.ip,
        endpoint: req.originalUrl
      });
      clearAuthCookies(req, res);
      return response.error(res, 'فشل التحقق الأمني من مصدر الطلب (CSRF)', 'SECURITY_BREACH', 403);
    }
  }

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

    const { accessToken, newRefreshToken, user } = await TokenService.validateAndRotate(token, clientIp, currentFingerprint);

    await auditService.log({
      userId: user.uuid,
      userRole: user.role,
      action: 'TOKEN_REFRESH',
      req
    });

    return sendHybridTokens(req, res, user, accessToken, newRefreshToken.token);

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
 * 🔑 Enterprise Login Orchestrator (Hardened with Redis Atomic Counter)
 */
const login = async (req, res) => {
  const { email, password, fcmToken } = req.body;
  const start = Date.now();

  try {
    if (!email || !password) {
      return response.error(res, 'البريد الإلكتروني وكلمة المرور مطلوبان', 'MISSING_FIELDS', 400);
    }

    const cleanEmail = email.toLowerCase().trim();
    const blindedEmail = hashBlind(cleanEmail);

    const configService = require('../services/configService');
    const systemConfig = await configService.getFullConfig();
    const { maxLoginAttempts, lockDurationMinutes, timingDelayMs } = systemConfig.security;

    const redisLockoutKey = `login_fail:${blindedEmail}`;
    const currentAttempts = await redis.get(redisLockoutKey);

    if (currentAttempts && parseInt(currentAttempts, 10) >= maxLoginAttempts) {
      let ttlSeconds = await redis.ttl(redisLockoutKey);
      if (ttlSeconds < 0) ttlSeconds = lockDurationMinutes * 60;
      const remainingMinutes = Math.ceil(ttlSeconds / 60);
      return response.error(res, `الحساب مغلق مؤقتاً. حاول مجدداً بعد ${remainingMinutes} دقيقة.`, 'ACCOUNT_LOCKED', 403);
    }

    let user = await prisma.user.findUnique({
      where: { emailHash: blindedEmail },
      include: { branch: true }
    });

    let customer = null;
    if (!user) {
      customer = await prisma.customer.findUnique({ where: { emailHash: blindedEmail } });
    }

    const account = user || customer;

    if (account && account.lockUntil && account.lockUntil > new Date()) {
      const remainingMinutes = Math.ceil((account.lockUntil - new Date()) / 60000);
      return response.error(res, `الحساب مغلق مؤقتاً. حاول مجدداً بعد ${remainingMinutes} دقيقة.`, 'ACCOUNT_LOCKED', 403);
    }

    if (!account || !account.password) {
      await redis.incr(redisLockoutKey);
      await redis.expire(redisLockoutKey, lockDurationMinutes * 60);

      await auditService.log({
        action: 'LOGIN_FAIL',
        status: 'FAIL',
        severity: 'WARN',
        metadata: { identifier: blindedEmail, reason: 'ACCOUNT_NOT_FOUND' },
        req
      });

      await new Promise(r => setTimeout(r, timingDelayMs));
      return response.error(res, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS', 401);
    }

    const match = await bcrypt.compare(password, account.password);

    if (!match) {
      const newAttempts = await redis.incr(redisLockoutKey);
      await redis.expire(redisLockoutKey, lockDurationMinutes * 60);

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
        metadata: { failedAttempts: newAttempts, locked: !!lockUntil },
        req
      });

      const elapsed = Date.now() - start;
      if (elapsed < timingDelayMs) await new Promise(r => setTimeout(r, timingDelayMs - elapsed));

      return response.error(res, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS', 401);
    }

    await redis.del(redisLockoutKey);
    if (account.failedAttempts > 0) {
      const table = user ? prisma.user : prisma.customer;
      await table.update({ where: { id: account.id }, data: { failedAttempts: 0, lockUntil: null } });
    }

    const isDisabled = (user && !user.isActive) || (customer && customer.isBlacklisted);
    if (isDisabled) {
      return response.error(res, 'هذا الحساب محظور حالياً، يرجى التواصل مع الدعم', 'ACCOUNT_DISABLED', 403);
    }

    if (fcmToken) {
      const table = user ? prisma.user : prisma.customer;
      await table.update({ where: { id: account.id }, data: { fcmToken: encrypt(fcmToken) } }).catch(() => {});
    }

    const fingerprint = generateFingerprint(req);
    const { token: refreshTokenStr, jti } = await TokenService.generateAndSaveRefreshToken(account, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      fingerprint: fingerprint.hash
    });
    const accessToken = TokenService.generateAccessToken(account, jti);

    await auditService.log({ userId: account.uuid, action: 'LOGIN_SUCCESS', req });

    return sendHybridTokens(req, res, account, accessToken, refreshTokenStr);

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
 * ✅ Phase 2: Verify Registration OTP & Create User (Hybrid Enabled)
 */
const verifyRegistration = async (req, res) => {
  const { email, code } = req.body;
  try {
    const cleanEmail = email.toLowerCase().trim();
    const blindedEmail = hashBlind(cleanEmail);

    const otpRecord = await prisma.otpCode.findFirst({
      where: { emailHash: blindedEmail, purpose: 'registration', used: false },
      orderBy: { createdAt: 'desc' }
    });

    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      return response.error(res, 'كود التحقق غير صحيح أو منتهي الصلاحية', 'INVALID_OTP', 400);
    }

    if (otpRecord.attempts >= 5) {
      await prisma.otpCode.update({ where: { id: otpRecord.id }, data: { used: true } });
      return response.error(res, 'تم تجاوز الحد الأقصى من المحاولات، تم قفل الرمز', 'OTP_LOCKED', 429);
    }

    const isMatch = await bcrypt.compare(code, otpRecord.codeHash);

    if (!isMatch) {
      await prisma.otpCode.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } }
      });

      if (otpRecord.attempts + 1 >= 5) {
        await prisma.otpCode.update({ where: { id: otpRecord.id }, data: { used: true } });
        return response.error(res, 'تم تجاوز الحد الأقصى من المحاولات، تم قفل الرمز', 'OTP_LOCKED', 429);
      }

      return response.error(res, 'كود التحقق غير صحيح', 'INVALID_OTP', 400);
    }

    const { name, password, phone } = otpRecord.metadata;
    const account = await prisma.customer.create({
      data: {
        name,
        email: encrypt(cleanEmail),
        emailHash: blindedEmail,
        password,
        phone: phone ? encrypt(phone) : null,
        phoneHash: phone ? hashBlind(phone) : null,
        fcmToken: otpRecord.metadata.fcmToken ? encrypt(otpRecord.metadata.fcmToken) : null
      }
    });

    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { used: true }
    });

    const { token, jti } = await TokenService.generateAndSaveRefreshToken(account);
    const accessToken = TokenService.generateAccessToken(account, jti);

    if (!token || typeof token !== 'string') {
      throw new Error('[CRITICAL] Invalid refresh token generated during registration');
    }

    return sendHybridTokens(req, res, account, accessToken, token, {
      phone: phone ? decrypt(phone) : null
    });

  } catch (error) {
    logger.error('Verify registration error', { error: error.message, code: error.code });

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
      logger.debug('Forgot password attempt for non-existent account', { ip: req.ip });
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
 * 🔑 Phase 2: Reset Password (Verify OTP + Update + Hybrid Response)
 */
const resetPassword = async (req, res) => {
    const { email, code, newPassword } = req.body;
  const cleanEmail = email.toLowerCase().trim();
  const blindedEmail = hashBlind(cleanEmail);

  try {
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.isValid) {
      return response.error(res, passwordValidation.message, 'WEAK_PASSWORD', 400);
    }

    const otpRecord = await prisma.otpCode.findFirst({
      where: { emailHash: blindedEmail, purpose: 'password_reset', used: false },
      orderBy: { createdAt: 'desc' }
    });

    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      return response.error(res, 'كود التحقق غير صحيح أو منتهي الصلاحية', 'INVALID_OTP', 400);
    }

    if (otpRecord.attempts >= 5) {
      await prisma.otpCode.update({ where: { id: otpRecord.id }, data: { used: true } });
      return response.error(res, 'تم تجاوز الحد الأقصى من المحاولات، تم قفل الرمز', 'OTP_LOCKED', 429);
    }

    const isMatch = await bcrypt.compare(code, otpRecord.codeHash);
    if (!isMatch) {
      await prisma.otpCode.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } }
      });

      if (otpRecord.attempts + 1 >= 5) {
        await prisma.otpCode.update({ where: { id: otpRecord.id }, data: { used: true } });
        return response.error(res, 'تم تجاوز الحد الأقصى من المحاولات، تم قفل الرمز', 'OTP_LOCKED', 429);
      }

      return response.error(res, 'كود التحقق غير صحيح', 'INVALID_OTP', 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    let account = await prisma.user.findUnique({ where: { emailHash: blindedEmail } });
    let isUser = true;

    if (!account) {
      account = await prisma.customer.findUnique({ where: { emailHash: blindedEmail } });
      isUser = false;
    }

    if (!account) {
      return response.error(res, 'الحساب غير موجود', 'USER_NOT_FOUND', 404);
    }

    let updatedAccount;
    await prisma.$transaction(async (tx) => {
      if (isUser) {
        updatedAccount = await tx.user.update({
          where: { emailHash: blindedEmail },
          data: {
            password: hashedPassword,
            failedAttempts: 0,
            lockUntil: null,
            authVersion: { increment: 1 }
          }
        });
      } else {
        updatedAccount = await tx.customer.update({
          where: { emailHash: blindedEmail },
          data: {
            password: hashedPassword,
            failedAttempts: 0,
            lockUntil: null,
            authVersion: { increment: 1 }
          }
        });
      }

      await tx.refreshToken.updateMany({
        where: { userId: updatedAccount.uuid },
        data: { isRevoked: true }
      });

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

    try {
      const tokenBlacklistService = require('../services/tokenBlacklistService');
      await tokenBlacklistService.blacklistUserSessions(updatedAccount.uuid, 'PASSWORD_CHANGED');
    } catch (blacklistErr) {
      logger.warn('[Auth] Token session blacklisting failed on password reset', { error: blacklistErr.message });
    }

    await redis.del(`login_fail:${blindedEmail}`);

    logger.security('Password reset — all sessions revoked', { email: cleanEmail, uuid: updatedAccount.uuid });

    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { used: true }
    });

    const { token, jti } = await TokenService.generateAndSaveRefreshToken(updatedAccount);
    const accessToken = TokenService.generateAccessToken(updatedAccount, jti);

    if (!token || typeof token !== 'string') {
      throw new Error('[CRITICAL] Invalid refresh token generated during password reset');
    }

    return sendHybridTokens(req, res, updatedAccount, accessToken, token, {
      phone: updatedAccount.phone ? decrypt(updatedAccount.phone) : null
    });

  } catch (error) {
    logger.error('Reset password error', { error: error.message });
    return response.error(res, 'حدث خطأ أثناء تغيير كلمة المرور', 'SERVER_ERROR', 500);
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
