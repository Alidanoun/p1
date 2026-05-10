const { validationResult } = require('express-validator');

/**
 * 🛡️ Validation Result Checker
 * Middleware to intercept validation errors and pass them to the global error handler.
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }

  const extractedErrors = [];
  errors.array().map(err => extractedErrors.push({ [err.path]: err.msg }));

  const error = new Error('خطأ في التحقق من البيانات');
  error.statusCode = 400;
  error.errors = extractedErrors; // Caught by updated errorHandler
  return next(error);
};

module.exports = validate;
