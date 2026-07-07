/**
 * Unified Response Handler for the System
 * Standardizes API output for CRM-grade robustness.
 */

const success = (res, data, messageOrStatusCode = 200, statusCode = 200) => {
  let finalStatus = 200;
  let finalData = data;

  if (typeof messageOrStatusCode === 'number') {
    finalStatus = messageOrStatusCode;
  } else {
    finalStatus = statusCode;
    if (typeof messageOrStatusCode === 'string') {
      if (finalData && typeof finalData === 'object' && !Array.isArray(finalData)) {
        finalData = { ...finalData, message: messageOrStatusCode };
      } else {
        finalData = { result: finalData, message: messageOrStatusCode };
      }
    }
  }

  return res.status(finalStatus).json({
    success: true,
    data: finalData
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
