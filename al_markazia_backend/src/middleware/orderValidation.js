/**
 * Middleware for validating order-related requests
 */
const xss = require('xss');

/**
 * 🛡️ Comprehensive Order Creation Validator
 */
exports.validateOrderCreate = (req, res, next) => {
  const { customerName, address, notes, cartItems } = req.body;

  // 1. Sanitization & XSS Prevention
  if (customerName) req.body.customerName = xss(customerName.trim()).substring(0, 100);
  if (address) req.body.address = xss(address.trim()).substring(0, 500);
  if (notes) req.body.notes = xss(notes.trim()).substring(0, 500);

  // 2. Structural Integrity
  if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
    return res.status(400).json({ success: false, error: 'يجب إضافة منتجات للطلب' });
  }

  // 3. Cart Item Hardening
  for (const item of cartItems) {
    if (!item.itemId || !item.quantity || item.quantity <= 0) {
      return res.status(400).json({ success: false, error: 'بيانات المنتجات غير صالحة' });
    }
    // 🛡️ Price Hijack Prevention: Force recalculation in service layer
    delete item.unitPrice; 
    delete item.lineTotal;
  }

  next();
};

/**
 * 🛡️ Order Rating Validator
 */
exports.validateOrderRating = (req, res, next) => {
  const { rating, comment } = req.body;
  
  if (rating === null) return next();
  
  if (rating === undefined || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, error: 'التقييم يجب أن يكون بين 1 و 5' });
  }

  if (comment) {
    req.body.comment = xss(comment.trim()).substring(0, 500);
  }

  next();
};

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
  const { action, reason, itemsToCancel, notificationId } = req.body;

  if (!notificationId) {
    return res.status(400).json({ success: false, message: 'معرف الإشعار مطلوب' });
  }

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({
      success: false,
      message: 'الإجراء المختار غير صالح (يجب أن يكون قبول أو رفض)'
    });
  }

  if (action === 'approve') {
    if (!itemsToCancel || !Array.isArray(itemsToCancel) || itemsToCancel.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'يجب تحديد الأصناف لمعالجة الطلب'
      });
    }
  }

  if (action === 'reject' && (!reason || typeof reason !== 'string' || reason.trim() === '')) {
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

  if (reason.trim().length > 500) {
    return res.status(400).json({
      success: false,
      message: 'سبب الإلغاء لا يتجاوز 500 حرف'
    });
  }

  next();
};
