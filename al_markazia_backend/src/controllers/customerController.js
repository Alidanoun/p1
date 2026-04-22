
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { success, error: responseError } = require('../utils/response');
const customerRiskService = require('../services/customerRiskService');
const TokenService = require('../services/tokenService');

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

const loginCustomer = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return responseError(res, 'Phone is required', 'MISSING_FIELD', 400);
    
    let customer = await prisma.customer.findUnique({ where: { phone } });
    if (!customer) {
      return responseError(res, 'رقم الهاتف غير مسجل في النظام', 'NOT_FOUND', 401);
    }
    
    // CRM Improvement: Real-time risk status check on login
    const riskProfile = await customerRiskService.evaluateCustomerStatus(customer.id);
    const enrichedCustomer = { ...customer, ...riskProfile };
    
    // --- Enterprise Identity Layer: JWT Generation ---
    const accessToken = TokenService.generateAccessToken(enrichedCustomer);
    const refreshToken = await TokenService.generateAndSaveRefreshToken(enrichedCustomer);

    logger.security('Customer login successful', { 
      uuid: enrichedCustomer.uuid, 
      phone: enrichedCustomer.phone 
    });

    success(res, {
      accessToken,
      refreshToken,
      user: {
        id: enrichedCustomer.uuid,
        name: enrichedCustomer.name,
        phone: enrichedCustomer.phone,
        username: enrichedCustomer.username,
        isBlacklisted: enrichedCustomer.isBlacklisted
      }
    });
  } catch (error) {
    logger.error('Customer login error', { error: error.message });
    responseError(res, 'Failed to login', 'AUTH_ERROR');
  }
};

const registerCustomer = async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !phone) return responseError(res, 'الاسم ورقم الهاتف مطلوبان', 'MISSING_FIELDS', 400);
    
    const existing = await prisma.customer.findUnique({ where: { phone } });
    if (existing) {
      return responseError(res, 'هذا الرقم مسجل مسبقاً يرجى تسجيل الدخول', 'DUPLICATE', 400);
    }
    
    const customer = await prisma.customer.create({ data: { name, phone } });
    logger.info('New customer registered', { phone, name, uuid: customer.uuid });

    // --- Enterprise Identity Layer: JWT Generation ---
    const accessToken = TokenService.generateAccessToken(customer);
    const refreshToken = await TokenService.generateAndSaveRefreshToken(customer);

    success(res, {
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
    logger.error('Customer registration error', { error: error.message });
    responseError(res, 'Failed to register', 'SERVER_ERROR');
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
  loginCustomer,
  registerCustomer,
  getBlacklistedCustomers,
  getBlacklistCount,
  blockCustomer,
  unblockCustomer
};
