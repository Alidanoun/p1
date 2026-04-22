const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const TokenService = require('../services/tokenService');
const { error: responseError } = require('../utils/response');

const refreshToken = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return responseError(res, 'Refresh token is required', 'MISSING_TOKEN', 400);
  }

  try {
    // 🛡️ Secure Rotation & Abuse Detection
    const decoded = await TokenService.validateAndRotate(refreshToken);
    
    // Identity lookup based on role
    let user;
    if (decoded.role === 'admin' || decoded.role === 'super_admin') {
      user = await prisma.user.findFirst({ where: { uuid: decoded.id } });
    } else {
      user = await prisma.customer.findFirst({ where: { uuid: decoded.id } });
    }

    if (!user) {
      logger.security('Refresh token for non-existent user/customer', { uuid: decoded.id, role: decoded.role });
      return responseError(res, 'الجلسة غير صالحة', 'INVALID_SESSION', 401);
    }

    // Issue New Pair (Rotation)
    const newAccessToken = TokenService.generateAccessToken(user);
    const newRefreshToken = await TokenService.generateAndSaveRefreshToken(user);

    logger.info('Session rotated successfully', { userId: user.uuid, role: user.role || 'customer' });
    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (error) {
    if (error.message === 'TOKEN_REUSE_DETECTED') {
      return responseError(res, 'تنبيه أمني: تم اكتشاف محاولة اختراق الجلسة. تم تسجيل الخروج من كافة الأجهزة.', 'SECURITY_BREACH', 401);
    }
    logger.security('Invalid refresh attempt', { error: error.message });
    return responseError(res, 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول', 'SESSION_EXPIRED', 401);
  }
};

const login = async (req, res) => {
  const { email, password, fcmToken } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      logger.security('Invalid login attempt: User not found', { identifier: email, ip: req.ip });
      return responseError(res, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS', 401);
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      logger.security('Invalid login attempt: Password mismatch', { identifier: email, ip: req.ip });
      return responseError(res, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS', 401);
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
    
    logger.security('Valid login', { 
      role: user.role,
      uuid: user.uuid, 
      ip: req.ip 
    });

    res.json({ 
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
    responseError(res, 'Internal Server Error', 'SERVER_ERROR', 500);
  }
};

module.exports = { login, refreshToken };
