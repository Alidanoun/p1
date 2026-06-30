const prisma = require('../lib/prisma');
const response = require('../utils/response');
const logger = require('../utils/logger');
const discountService = require('../services/discountService');

/**
 * 🎛️ Discount Controller (Admin Only)
 */

exports.getCampaigns = async (req, res) => {
  try {
    const campaigns = await prisma.discountCampaign.findMany({
      include: {
        coupons: true,
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    // Transform data for the admin panel
    const formatted = campaigns.map(c => ({
      ...c,
      couponCode: c.coupons[0]?.code || 'N/A',
      globalUsageLimit: c.coupons[0]?.globalUsageLimit,
      usedCount: c.coupons[0]?.usedCount || 0,
      userUsageLimit: c.coupons[0]?.userUsageLimit || 1,
    }));

    return response.success(res, formatted);
  } catch (error) {
    logger.error('Fetch campaigns error', { error: error.message });
    return response.error(res, 'فشل جلب الحملات', 'FETCH_ERROR', 500);
  }
};

exports.createCampaign = async (req, res) => {
  try {
    const {
      title,
      description,
      type,
      value,
      minOrderValue,
      maxDiscount,
      targetScope,
      targetId,
      startDate,
      endDate,
      isActive,
      couponCode, // The custom code
      globalUsageLimit,
      userUsageLimit
    } = req.body;

    // Validation
    if (!title || !type || !value || !startDate || !endDate || !couponCode) {
      return response.error(res, 'الرجاء تعبئة جميع الحقول الإلزامية', 'VALIDATION_ERROR', 400);
    }

    // Check if code exists
    const existingCoupon = await prisma.coupon.findUnique({
      where: { code: couponCode.toUpperCase() }
    });
    if (existingCoupon) {
      return response.error(res, 'كود الخصم مستخدم مسبقاً', 'DUPLICATE_CODE', 400);
    }

    const campaign = await prisma.$transaction(async (tx) => {
      const newCampaign = await tx.discountCampaign.create({
        data: {
          title,
          description,
          type,
          value: Number(value),
          minOrderValue: minOrderValue ? Number(minOrderValue) : 0,
          maxDiscount: maxDiscount ? Number(maxDiscount) : null,
          targetScope: targetScope || 'GLOBAL',
          targetId: targetId || null,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          isActive: isActive !== undefined ? isActive : true,
          coupons: {
            create: {
              code: couponCode.toUpperCase(),
              globalUsageLimit: globalUsageLimit ? Number(globalUsageLimit) : null,
              userUsageLimit: userUsageLimit ? Number(userUsageLimit) : 1,
            }
          }
        },
        include: { coupons: true }
      });
      return newCampaign;
    });

    // Refresh Redis Cache
    await discountService.refreshActiveCampaignsCache();

    return response.success(res, campaign, 201);
  } catch (error) {
    logger.error('Create campaign error', { error: error.message });
    return response.error(res, 'فشل إنشاء الحملة', 'CREATE_ERROR', 500);
  }
};

exports.toggleCampaignStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const campaign = await prisma.discountCampaign.update({
      where: { id },
      data: { isActive },
    });

    // Refresh Redis Cache
    await discountService.refreshActiveCampaignsCache();

    return response.success(res, campaign);
  } catch (error) {
    logger.error('Toggle campaign error', { error: error.message });
    return response.error(res, 'فشل تعديل حالة الحملة', 'UPDATE_ERROR', 500);
  }
};

exports.deleteCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Delete campaign (cascade will delete coupons)
    await prisma.discountCampaign.delete({
      where: { id }
    });

    // Refresh Redis Cache
    await discountService.refreshActiveCampaignsCache();

    return response.success(res, { deleted: true });
  } catch (error) {
    logger.error('Delete campaign error', { error: error.message });
    return response.error(res, 'فشل حذف الحملة', 'DELETE_ERROR', 500);
  }
};
