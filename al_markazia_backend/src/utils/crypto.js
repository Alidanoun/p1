const crypto = require('crypto');
const logger = require('./logger');
const secretProvider = require('../config/secretProvider');

/**
 * 🔒 Enterprise Encryption Utility (AES-256-CBC)
 * Used to protect PII (Personally Identifiable Information) in the database.
 */

const isDevOrTest = process.env.NODE_ENV !== 'production';
if (isDevOrTest && !process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = 'almarkazia-secure-development-key-32bytes-fallback';
}

const rawKey = secretProvider.getSecretSync('ENCRYPTION_KEY');

if (!rawKey || rawKey.length < 32) {
  logger.error('❌ CRITICAL: ENCRYPTION_KEY is missing or too weak (must be at least 32 characters long).');
  process.exit(1);
}

// Load and harden key using scryptSync
const ENCRYPTION_KEY = crypto.scryptSync(rawKey, 'salt-pepper', 32);
const IV_LENGTH = 16;

/**
 * 🔐 Encrypts a string using AES-256-CBC with a random IV.
 * Format: iv:encrypted_data
 * [IDEMPOTENT]: Detects if already encrypted to avoid double-encryption.
 */
function encrypt(text) {
  if (!text || typeof text !== 'string') return text;

  // 🛡️ [SEC-FIX] Avoid Double Encryption
  // Check if string follows the pattern 'hex(32):hex'
  if (text.includes(':')) {
    const [ivHex] = text.split(':');
    if (ivHex.length === 32 && /^[0-9a-fA-F]+$/.test(ivHex)) {
      return text; // Already encrypted
    }
  }
  
  if (!ENCRYPTION_KEY) {
    logger.error('🚨 [CRITICAL] Encryption failed: ENCRYPTION_KEY is missing');
    throw new Error('ENCRYPTION_KEY_MISSING');
  }

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (err) {
    logger.error('🚨 [CRITICAL] Encryption failure detected. Process halted to prevent data exposure.', { error: err.message });
    throw new Error(`ENCRYPTION_FAILED: ${err.message}`);
  }
}

/**
 * 🔓 Decrypts a string.
 */
function decrypt(text) {
  if (!text || typeof text !== 'string' || !text.includes(':')) return text;
  
  try {
    const [ivHex, encryptedHex] = text.split(':');
    if (!ivHex || !encryptedHex) return text;

    const iv = Buffer.from(ivHex, 'hex');
    const encryptedText = Buffer.from(encryptedHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString();
  } catch (err) {
    // If decryption fails, it might be plain text (legacy data)
    logger.debug('[Crypto] Decryption failed (possibly plain text)', { error: err.message });
    return text;
  }
}

/**
 * 🛡️ Blind Indexing (Hashing with secret pepper)
 * Allows searching/uniqueness check on encrypted fields.
 */
function hashBlind(text) {
  if (!text) return text;
  
  if (!ENCRYPTION_KEY) {
    logger.error('🚨 [CRITICAL] Hashing failed: ENCRYPTION_KEY is missing');
    throw new Error('HASHING_KEY_MISSING');
  }

  try {
    return crypto.createHmac('sha256', ENCRYPTION_KEY)
      .update(String(text))
      .digest('hex');
  } catch (err) {
    logger.error('🚨 [CRITICAL] Hashing failure detected.', { error: err.message });
    throw new Error(`HASHING_FAILED: ${err.message}`);
  }
}

module.exports = { encrypt, decrypt, hashBlind };
