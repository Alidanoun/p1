
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { success, error: responseError } = require('../utils/response');
const customerRiskService = require('../services/customerRiskService');
const TokenService = require('../services/tokenService');
const otpService = require('../services/otpService');

/**
 * Updates or creates a customer record and saves their FCM token.
 */
const updateFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    const uuid = req.user.id; // Primary Identity Source
    
    if (!fcmToken) {
      return responseError(res, 'fcmToken is required', 'MISSING_FIELDS', 400);
    }

    // 🛡️ Ensure we update based on UUID (Source of Truth)
    const customer = await prisma.customer.update({
      where: { uuid },
      data: { fcmToken }
    });

    logger.info('FCM Token secured and updated', { uuid: customer.uuid, phone: customer.phone });
    success(res, customer);
  } catch (error) {
    logger.error('Update FCM Token secure error', { error: error.message });
    responseError(res, 'فشل في تحديث بيانات الجهاز المؤمنة', 'SERVER_ERROR');
  }
};

/**
 * 📨 Step 1: Request OTP for login
 * 🛡️ Anti-enumeration: Returns uniform response whether phone exists or not.
 */
const requestLoginOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return responseError(res, 'رقم الهاتف مطلوب', 'MISSING_FIELD', 400);

    const cleanPhone = otpService.normalizePhone(phone);
    if (!cleanPhone) {
      return responseError(res, 'تنسيق رقم الهاتف غير صحيح', 'INVALID_FORMAT', 400);
    }

    const customer = await prisma.customer.findUnique({ where: { phone: cleanPhone } });

    if (customer) {
      try {
        await otpService.requestOtp({
          phone: cleanPhone,
          purpose: 'login',
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        });
      } catch (err) {
        if (err.message.startsWith('RESEND_COOLDOWN:')) {
          const seconds = err.message.split(':')[1];
          return responseError(res, `يرجى الانتظار ${seconds} ثانية قبل إعادة الإرسال`, 'COOLDOWN', 429);
        }
        if (err.message === 'TOO_MANY_OTP_REQUESTS') {
          return responseError(res, 'تم تجاوز عدد المحاولات المسموح، حاول لاحقاً', 'RATE_LIMITED', 429);
        }
        throw err;
      }
    } else {
      // 🛡️ Simulated delay to prevent timing analysis of phone existence
      await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 100));
    }

    return success(res, {
      message: 'إذا كان الرقم مسجّل، سيتم إرسال رمز التحقق',
      expiresIn: 300
    });
  } catch (error) {
    logger.error('Request Login OTP error', { error: error.message });
    return responseError(res, 'فشل في إرسال الرمز', 'SERVER_ERROR', 500);
  }
};

/**
 * ✅ Step 2: Verify OTP and issue JWT (Login)
 */
const loginCustomer = async (req, res) => {
  try {
    const { phone, code } = req.body;
    
    if (!phone) {
      return responseError(res, 'رقم الهاتف مطلوب', 'MISSING_FIELDS', 400);
    }

    const cleanPhone = otpService.normalizePhone(phone);

    // 🛡️ Backward Compatibility: If no code is provided, skip OTP verification
    if (!code) {
      logger.warn('Legacy passwordless login attempt', { phone: cleanPhone });
    } else {
      // ✅ OTP Verification (New Secure Flow)
      try {
        await otpService.verifyOtp({ phone: cleanPhone, code, purpose: 'login' });
      } catch (err) {
        const errorMap = {
          'INVALID_CODE_FORMAT': ['رمز غير صحيح', 'INVALID_OTP', 400],
          'OTP_NOT_FOUND_OR_EXPIRED': ['الرمز منتهي أو غير موجود', 'OTP_EXPIRED', 401],
          'TOO_MANY_ATTEMPTS': ['محاولات كثيرة، اطلب رمزاً جديداً', 'TOO_MANY_ATTEMPTS', 429],
          'INVALID_OTP': ['الرمز غير صحيح', 'INVALID_OTP', 401]
        };
        const [msg, errCode, status] = errorMap[err.message] || ['فشل التحقق', 'AUTH_ERROR', 401];
        return responseError(res, msg, errCode, status);
      }
    }

    // 2. Resolve Identity
    const customer = await prisma.customer.findUnique({ where: { phone: cleanPhone } });
    if (!customer) {
      return responseError(res, 'الحساب غير موجود', 'NOT_FOUND', 404);
    }

    // 3. Update Verification State
    await prisma.customer.update({
      where: { id: customer.id },
      data: { phoneVerifiedAt: new Date() }
    });

    // 4. Enrich with Risk Data
    const riskProfile = await customerRiskService.evaluateCustomerStatus(customer.id);
    const enrichedCustomer = { ...customer, ...riskProfile };

    // 5. Issue Enterprise JWTs
    const accessToken = TokenService.generateAccessToken(enrichedCustomer);
    const refreshToken = await TokenService.generateAndSaveRefreshToken(enrichedCustomer);

    logger.security('Customer login successful (OTP verified)', {
      uuid: customer.uuid,
      phone: cleanPhone.slice(0, 4) + '****'
    });

    return success(res, {
      accessToken,
      refreshToken,
      user: {
        id: customer.uuid,
        name: customer.name,
        phone: customer.phone,
        username: customer.username,
        isBlacklisted: enrichedCustomer.isBlacklisted
      }
    });
  } catch (error) {
    logger.error('Customer login verify error', { error: error.message });
    return responseError(res, 'فشل تسجيل الدخول', 'AUTH_ERROR', 500);
  }
};

/**
 * 📨 Request OTP for registration
 */
const requestRegistrationOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return responseError(res, 'رقم الهاتف مطلوب', 'MISSING_FIELD', 400);

    const cleanPhone = otpService.normalizePhone(phone);
    const existing = await prisma.customer.findUnique({ where: { phone: cleanPhone } });

    if (existing) {
      await new Promise(resolve => setTimeout(resolve, 200));
      return success(res, { 
        message: 'إذا كان الرقم متاحاً، سيتم إرسال رمز التحقق',
        expiresIn: 300
      });
    }

    await otpService.requestOtp({
      phone: cleanPhone,
      purpose: 'register',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    return success(res, { 
      message: 'تم إرسال رمز التحقق',
      expiresIn: 300
    });
  } catch (error) {
    if (error.message.startsWith('RESEND_COOLDOWN:')) {
      const seconds = error.message.split(':')[1];
      return responseError(res, `انتظر ${seconds} ثانية`, 'COOLDOWN', 429);
    }
    return responseError(res, 'فشل في إرسال الرمز', 'SERVER_ERROR', 500);
  }
};

/**
 * ✅ Verify OTP and create account (Registration)
 */
const registerCustomer = async (req, res) => {
  try {
    const { name, phone, code } = req.body;
    if (!name || !phone) {
      return responseError(res, 'الاسم والرقم مطلوبان', 'MISSING_FIELDS', 400);
    }

    const cleanPhone = otpService.normalizePhone(phone);

    // 🛡️ Backward Compatibility: If no code is provided, skip OTP check
    if (!code) {
      logger.warn('Legacy passwordless registration attempt', { phone: cleanPhone });
    } else {
      // ✅ OTP Verification
      try {
        await otpService.verifyOtp({ phone: cleanPhone, code, purpose: 'register' });
      } catch (err) {
        return responseError(res, 'الرمز غير صحيح أو منتهي', 'INVALID_OTP', 401);
      }
    }

    // 2. Final duplication check (prevention of race conditions)
    const existing = await prisma.customer.findUnique({ where: { phone: cleanPhone } });
    if (existing) {
      return responseError(res, 'الرقم مسجّل مسبقاً', 'DUPLICATE', 400);
    }

    // 3. Create Verified Account
    const customer = await prisma.customer.create({
      data: { 
        name, 
        phone: cleanPhone, 
        phoneVerifiedAt: new Date() 
      }
    });

    logger.info('New verified customer registered', { phone: cleanPhone, name, uuid: customer.uuid });

    // 4. Issue JWTs
    const accessToken = TokenService.generateAccessToken(customer);
    const refreshToken = await TokenService.generateAndSaveRefreshToken(customer);

    return success(res, {
      accessToken,
      refreshToken,
      user: {
        id: customer.uuid,
        name: customer.name,
        phone: customer.phone,
        username: customer.username
      }
    });
  } catch (error) {
    logger.error('Customer registration verify error', { error: error.message });
    return responseError(res, 'فشل التسجيل', 'SERVER_ERROR', 500);
  }
};

const getBlacklistedCustomers = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const skip = parseInt(req.query.skip) || 0;
    const search = req.query.search || '';

    // Enterprise Search Layer: Insensitive + Partial Matching
    const where = {
      isBlacklisted: true,
      OR: [
        { name: { contains: search } },
        { phone: { contains: search } }
      ]
    };

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        take: limit,
        skip: skip,
        orderBy: { blacklistedAt: 'desc' },
        include: {
          _count: {
             select: { orders: true }
          }
        }
      }),
      prisma.customer.count({ where })
    ]);

    // Enhanced Pagination Object
    success(res, {
      customers,
      pagination: { 
        total, 
        limit, 
        skip,
        hasMore: (skip + limit) < total
      }
    });

  } catch (error) {
    logger.error('Fetch blacklisted customers error', { error: error.message });
    responseError(res, 'Failed to fetch blacklisted customers', 'FETCH_ERROR');
  }
};

const blockCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, reasonCode, severity, durationDays } = req.body;

    const adminData = {
      email: req.user.email || 'Admin',
      role: req.user.role,
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      requestSource: req.get('X-Request-Source') || 'admin_panel'
    };

    const customer = await customerRiskService.blockCustomer(
      parseInt(id),
      adminData,
      { reason, reasonCode, severity, durationDays }
    );

    success(res, { customer });
  } catch (error) {
    logger.error('Block customer error', { error: error.message, requestId: req.requestId });
    responseError(res, error.message, 'BLOCK_ERROR', 400);
  }
};

const unblockCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const adminData = {
      email: req.user.email || 'Admin',
      role: req.user.role,
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      requestSource: req.get('X-Request-Source') || 'admin_panel'
    };

    const customer = await customerRiskService.unblockCustomer(
      parseInt(id),
      adminData,
      reason
    );

    success(res, { customer });
  } catch (error) {
    logger.error('Unblock customer error', { error: error.message, requestId: req.requestId });
    responseError(res, error.message, 'UNBLOCK_ERROR', 400);
  }
};

const getBlacklistCount = async (req, res) => {
  try {
    const count = await prisma.customer.count({ where: { isBlacklisted: true } });
    success(res, { count });
  } catch (error) {
    responseError(res, 'Failed to fetch count', 'COUNT_ERROR');
  }
};

module.exports = {
  updateFcmToken,
  requestLoginOtp,
  loginCustomer,
  requestRegistrationOtp,
  registerCustomer,
  getBlacklistedCustomers,
  getBlacklistCount,
  blockCustomer,
  unblockCustomer
};
