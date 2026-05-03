/**
 * 🧹 Audit Log Sanitizer
 * ينظف البيانات الحساسة قبل حفظها في Audit Logs
 */

const SENSITIVE_FIELDS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'privateKey',
  'creditCard',
  'cvv',
  'pin',
  'otp',
  'ssn', 
  'bankAccount',
  'routingNumber'
];

const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * تنظيف object من البيانات الحساسة
 */
const sanitizeObject = (obj, depth = 0) => {
  if (depth > 5) return '[DEPTH_LIMIT]'; 
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized = Array.isArray(obj) ? [] : {};

  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_FIELDS.some(field => 
      key.toLowerCase().includes(field.toLowerCase())
    );

    if (isSensitive) {
      sanitized[key] = REDACTED_PLACEHOLDER;
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeObject(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

/**
 * تنظيف string من بيانات حساسة محتملة
 */
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;

  // إزالة JWT tokens
  str = str.replace(/eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, '[JWT_TOKEN]');

  // إزالة أرقام بطاقات (16 رقم متصل)
  str = str.replace(/\b\d{16}\b/g, '[CARD_NUMBER]');

  return str;
};

const sanitizeForAudit = (data) => {
  if (!data) return data;

  if (typeof data === 'string') {
    return sanitizeString(data);
  }

  if (typeof data === 'object') {
    return sanitizeObject(data);
  }

  return data;
};

module.exports = {
  sanitizeForAudit,
  sanitizeObject,
  sanitizeString
};
