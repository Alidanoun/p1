/**
 * 🛡️ Security Utilities
 */

/**
 * 🧩 Safe JSON Parsing Wrapper
 * Prevents server crashes on malformed JSON strings.
 */
function safeJsonParse(input) {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error("Invalid JSON format");
  }
}

const crypto = require('crypto');

/**
 * 🆔 ID Validation Middleware
 * Ensures req.params[paramName] is a valid number before hitting Prisma.
 */
const validateId = (paramName = 'id') => (req, res, next) => {
  const id = Number(req.params[paramName]);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: `Invalid ${paramName}`
    });
  }

  req.params[paramName] = id;
  next();
};

/**
 * 🖥️ Device Fingerprinting (Enterprise Grade)
 * Generates components and a SHA-256 hash for secure device binding.
 */
function generateFingerprint(req) {
  const components = {
    ua: req.headers["user-agent"] || 'no-ua',
    ch: req.headers["sec-ch-ua"] || 'no-ch',
    platform: req.headers["sec-ch-ua-platform"] || 'unknown',
    lang: req.headers["accept-language"] || 'no-lang'
  };

  const data = Object.values(components).join("|");
  const hash = crypto.createHash("sha256").update(data).digest("hex");

  // ✅ Return hash and components, keep IP separate for audit logs
  return { 
    hash, 
    components, 
    ip: req.ip || req.headers['x-forwarded-for'] || 'unknown' 
  };
}

/**
 * 🔐 Password Complexity Validator
 * Requirements: Min 8 chars, 1 Uppercase, 1 Lowercase, 1 Number, 1 Special Char
 */
const validatePasswordStrength = (password) => {
  // Enhanced Regex: Allows common special characters like #, _, -, etc.
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#_\-])[A-Za-z\d@$!%*?&#_\-]{8,}$/;
  
  if (!password) {
    return { isValid: false, message: 'كلمة المرور مطلوبة' };
  }
  
  if (!passwordRegex.test(password)) {
    return {
      isValid: false,
      message: 'كلمة المرور يجب أن تكون 8 خانات على الأقل وتحتوي على حرف كبير، حرف صغير، رقم، ورمز خاص (@$!%*?&#_-)'
    };
  }
  
  return { isValid: true };
};

module.exports = {
  safeJsonParse,
  validateId,
  generateFingerprint,
  validatePasswordStrength
};
