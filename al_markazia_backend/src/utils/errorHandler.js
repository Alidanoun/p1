const logger = require('./logger');

/**
 * 🛡️ Centralized Error Hardening Utility
 * Purpose: Standardize API responses and prevent technical leakage (Prisma/Node errors).
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

const handleError = (err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';
  let statusCode = err.statusCode || 500;
  let message = err.message;
  let code = err.code || 'INTERNAL_ERROR';

  // 1. Log the full error internally
  logger.error(`[API ERROR] ${req.method} ${req.originalUrl}`, {
    message: err.message,
    code: err.code,
    stack: err.stack,
    userId: req.user?.id,
    ip: req.ip,
    requestId: req.id
  });

  // 2. Filter out sensitive DB/Prisma errors for the client in Production
  if (isProduction) {
    if (err.name?.includes('Prisma') || err.name?.includes('Database')) {
      statusCode = 500;
      message = 'حدث خطأ في معالجة البيانات، يرجى المحاولة لاحقاً';
      code = 'DATABASE_ERROR';
    } else if (!err.isOperational && statusCode === 500) {
      message = 'حدث خطأ داخلي في النظام، تم إبلاغ الفريق التقني';
      code = 'INTERNAL_SERVER_ERROR';
    }
  }

  if (err.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
  }

  // 3. Standard Secure Response
  res.status(statusCode).json({
    success: false,
    error: {
      message: message || 'حدث خطأ غير متوقع',
      code: code,
      // 🛠️ Include stack trace ONLY in development
      ...(!isProduction && { stack: err.stack }),
      requestId: req.id // Traceable ID for matching with logs
    }
  });
};

module.exports = { AppError, handleError };
