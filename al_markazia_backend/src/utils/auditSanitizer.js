/**
 * 🧹 Audit Log Sanitizer (Production-Hardened)
 * Purpose: Ensures sensitive PII and credentials are never stored in audit logs.
 */

const SENSITIVE_FIELDS = [
  'password', 'managerpassword', 'token', 'accesstoken', 'refreshtoken',
  'secret', 'apikey', 'privatekey', 'creditcard', 'cvv', 'pin', 'otp',
  'ssn', 'bankaccount', 'routingnumber', 'cardnumber', 'expirydate',
  'phone', 'phonehash', 'customerphone', 'email', 'emailhash', 'customername'
];

const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * 🎭 Masking Helper
 * Transforms "0791234567" -> "****567"
 * Transforms "user@example.com" -> "u***@e***.com"
 */
const maskValue = (val, key = '') => {
  if (!val || typeof val !== 'string') return val;

  const lowKey = key.toLowerCase();

  // 1. Password/Token/Secret -> Full Redaction
  if (lowKey.includes('password') || lowKey.includes('token') || lowKey.includes('secret') || lowKey.includes('key')) {
    return REDACTED_PLACEHOLDER;
  }

  // 2. Phone Masking (Keep last 3 digits)
  if (lowKey.includes('phone') || /^\d{9,15}$/.test(val)) {
    return val.length > 4 ? `****${val.slice(-3)}` : REDACTED_PLACEHOLDER;
  }

  // 3. Email Masking
  if (lowKey.includes('email') || val.includes('@')) {
    const [user, domain] = val.split('@');
    if (!domain) return REDACTED_PLACEHOLDER;
    return `${user.charAt(0)}***@${domain.charAt(0)}***${domain.slice(domain.lastIndexOf('.'))}`;
  }

  return REDACTED_PLACEHOLDER;
};

/**
 * 🌳 Recursive Object Sanitizer
 */
const sanitizeObject = (obj, depth = 0) => {
  if (depth > 5) return '[DEPTH_LIMIT]'; 
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized = Array.isArray(obj) ? [] : {};

  for (const [key, value] of Object.entries(obj)) {
    const lowKey = key.toLowerCase();
    const isSensitive = SENSITIVE_FIELDS.some(field => lowKey.includes(field));

    if (isSensitive) {
      sanitized[key] = maskValue(value, key);
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeObject(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

/**
 * 🧵 String-based PII Scrubber (Pattern Matching)
 */
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;

  let sanitized = str;

  // 1. Scrub JWTs
  sanitized = sanitized.replace(/eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, '[JWT_TOKEN]');

  // 2. Scrub Card Numbers (16 digits)
  sanitized = sanitized.replace(/\b\d{16}\b/g, '[CARD_NUMBER]');

  // 3. Scrub Emails
  sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL_REDACTED]');

  return sanitized;
};

/**
 * 🛡️ Main Entry Point
 */
const sanitizeForAudit = (data) => {
  if (!data) return data;

  try {
    if (typeof data === 'string') {
      return sanitizeString(data);
    }

    if (typeof data === 'object') {
      return sanitizeObject(data);
    }
  } catch (err) {
    return '[SANITIZATION_FAILED]';
  }

  return data;
};

module.exports = {
  sanitizeForAudit,
  sanitizeObject,
  sanitizeString
};
