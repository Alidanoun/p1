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

module.exports = {
  safeJsonParse,
  validateId,
  generateFingerprint
};
