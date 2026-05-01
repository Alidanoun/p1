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
  let { statusCode, message, code } = err;

  // 1. Log the full error internally
  logger.error(`[API ERROR] ${req.method} ${req.originalUrl}`, {
    message: err.message,
    code: err.code,
    stack: err.stack,
    userId: req.user?.id,
    ip: req.ip
  });

  // 2. Filter out sensitive DB/Prisma errors for the client
  if (err.name?.includes('Prisma') || err.name?.includes('Database')) {
    statusCode = 500;
    message = 'حدث خطأ في قاعدة البيانات، يرجى المحاولة لاحقاً';
    code = 'DATABASE_ERROR';
  }

  if (err.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
  }

  // 3. Standard Production-Grade Response
  res.status(statusCode || 500).json({
    success: false,
    error: {
      message: message || 'حدث خطأ غير متوقع',
      code: code || 'UNKNOWN_ERROR',
      requestId: req.id // Traceable ID for debugging
    }
  });
};

module.exports = { AppError, handleError };
