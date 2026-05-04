const response = require('../utils/response');
const logger = require('../utils/logger');

/**
 * 🛡️ Branch ID Sanitization Middleware
 * Strictly enforces that branchId must be a simple string.
 * Prevents Type Pollution attacks (Object/Array injection).
 */
module.exports = (req, res, next) => {
  const checkKeys = ['branchId', 'branch'];
  const sources = ['body', 'query', 'params'];

  for (const source of sources) {
    if (!req[source]) continue;

    for (const key of checkKeys) {
      const val = req[source][key];
      
      if (val !== undefined && val !== null) {
        // 🚨 Strict Validation: Must be a string
        if (typeof val !== 'string') {
          logger.security('TYPE_POLLUTION_ATTEMPT', {
            ip: req.ip,
            userId: req.user?.id,
            source,
            key,
            receivedType: typeof val,
            value: JSON.stringify(val)
          });
          return response.error(res, 'تنسيق معرف الفرع غير صالح (Must be a string)', 'INVALID_INPUT_TYPE', 400);
        }

        // 🚨 Optional: Length validation (UUIDs are ~36 chars, codes are short)
        if (val.length > 100) {
           return response.error(res, 'معرف الفرع طويل جداً', 'INVALID_INPUT_LENGTH', 400);
        }
      }
    }
  }

  next();
};
