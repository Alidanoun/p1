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
  path: '/auth',                                   // Restricted scope for security
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

    // ✅ Return both (Body is for legacy transition)
    response.success(res, { 
      accessToken, 
      refreshToken: newRefreshToken 
    });
  } catch (error) {
    if (error.message === 'TOKEN_REUSE_DETECTED') {
      res.clearCookie('refreshToken', { path: '/auth' });
      return response.error(res, 'تنبيه أمني: تم اكتشاف محاولة اختراق الجلسة. تم تسجيل الخروج من كافة الأجهزة.', 'SECURITY_BREACH', 401);
    }
    
    res.clearCookie('refreshToken', { path: '/auth' });
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
      refreshToken, 
      user: { 
        id: user.uuid,
        email: user.email, 
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

  res.clearCookie('refreshToken', { path: '/auth' });
  return res.json({ success: true, message: 'Logged out successfully' });
};

/**
 * 👤 Identity Bootstrap (Who am I?)
 */
const getMe = async (req, res) => {
  res.json({ 
    success: true, 
    data: {
      id: req.user.id,
      phone: req.user.phone,
      role: req.user.role
    } 
  });
};

module.exports = { login, refreshToken, logout, getMe };
