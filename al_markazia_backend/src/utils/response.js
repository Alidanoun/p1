/**
 * Unified Response Handler for the System
 * Standardizes API output for CRM-grade robustness.
 */

const success = (res, data, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    data
  });
};

const error = (res, message, code = 'INTERNAL_ERROR', statusCode = 500) => {
  return res.status(statusCode).json({
    success: false,
    error: {
      message,
      code
    }
  });
};

module.exports = { success, error };
