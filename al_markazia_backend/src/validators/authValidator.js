const { body } = require('express-validator');

/**
 * 🛡️ Authentication Input Validation
 */
const loginValidation = [
  body('email')
    .notEmpty().withMessage('البريد الإلكتروني مطلوب')
    .isEmail().withMessage('تنسيق البريد الإلكتروني غير صحيح')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('كلمة المرور مطلوبة')
    .isLength({ min: 6 }).withMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل')
];

const registerValidation = [
  body('name')
    .notEmpty().withMessage('الاسم مطلوب')
    .isString().trim().isLength({ min: 2, max: 50 }),
  body('email')
    .notEmpty().withMessage('البريد الإلكتروني مطلوب')
    .isEmail().withMessage('تنسيق البريد الإلكتروني غير صحيح')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('كلمة المرور مطلوبة')
    .isLength({ min: 8 }).withMessage('كلمة المرور يجب أن تكون 8 أحرف على الأقل')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('كلمة المرور يجب أن تحتوي على حرف كبير، حرف صغير، رقم، ورمز خاص'),
  body('phone')
    .optional()
    .matches(/^(\+?962|0)7[789]\d{7}$/).withMessage('رقم هاتف أردني غير صحيح')
];

module.exports = {
  loginValidation,
  registerValidation
};
