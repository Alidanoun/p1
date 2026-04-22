/**
 * Middleware for validating order-related requests
 */

exports.validatePartialCancelRequest = (req, res, next) => {
  const { itemIds, reason } = req.body;

  if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'يجب تحديد الأصناف المطلوب إلغاؤها'
    });
  }

  const allIntegers = itemIds.every(id => Number.isInteger(parseInt(id)));
  if (!allIntegers) {
    return res.status(400).json({
      success: false,
      message: 'معرفات الأصناف غير صالحة'
    });
  }

  if (reason && typeof reason !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'سبب الإلغاء يجب أن يكون نصاً'
    });
  }

  next();
};

exports.validateHandlePartialCancel = (req, res, next) => {
  const { action, rejectionReason, itemIds } = req.body;

  if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'يجب تحديد الأصناف لمعالجة الطلب'
    });
  }

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({
      success: false,
      message: 'الإجراء المختار غير صالح (يجب أن يكون قبول أو رفض)'
    });
  }

  if (action === 'reject' && (!rejectionReason || typeof rejectionReason !== 'string' || rejectionReason.trim() === '')) {
    return res.status(400).json({
      success: false,
      message: 'يجب ذكر سبب الرفض عند رفض الطلب'
    });
  }

  next();
};

exports.validateCancelOrder = (req, res, next) => {
  const { reason } = req.body;

  if (!reason || typeof reason !== 'string' || reason.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'يجب ذكر سبب الإلغاء'
    });
  }

  next();
};
