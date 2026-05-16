const crypto = require('crypto');
const logger = require('./logger');

/**
 * 🔒 Enterprise Encryption Utility (AES-256-CBC)
 * Used to protect PII (Personally Identifiable Information) in the database.
 */

const rawKey = process.env.ENCRYPTION_KEY;

/**
 * 🛡️ Validates key existence and length.
 * This is called by the envValidator, but we also check here as a safety net.
 */
function getEncryptionKey() {
  if (!rawKey || rawKey.length < 32) {
    throw new Error('CRITICAL_SECURITY_ERROR: ENCRYPTION_KEY is missing or too weak (min 32 chars).');
  }
  return crypto.scryptSync(rawKey, 'salt-pepper', 32);
}

let cachedKey = null;
try {
  cachedKey = getEncryptionKey();
} catch (e) {
  // We don't exit here to allow the envValidator to give a pretty error message first.
  // But subsequent calls to encrypt/decrypt will fail if cachedKey is null.
}

const IV_LENGTH = 16;

/**
 * 🔐 Encrypts a string using AES-256-CBC with a random IV.
 * Format: iv:encrypted_data
 * [IDEMPOTENT]: Detects if already encrypted to avoid double-encryption.
 */
function encrypt(text) {
  if (!text || typeof text !== 'string') return text;

  // 🛡️ Avoid Double Encryption
  if (text.includes(':')) {
    const [ivHex] = text.split(':');
    if (ivHex.length === 32 && /^[0-9a-fA-F]+$/.test(ivHex)) {
      return text; // Already encrypted
    }
  }
  
  if (!cachedKey) {
    logger.error('🚨 [CRITICAL] Encryption failed: ENCRYPTION_KEY is missing or invalid');
    throw new Error('ENCRYPTION_KEY_UNAVAILABLE');
  }

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', cachedKey, iv);
    
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (err) {
    logger.error('🚨 [CRITICAL] Encryption failure detected.', { error: err.message });
    throw new Error(`ENCRYPTION_FAILED: ${err.message}`);
  }
}

/**
 * 🔓 Decrypts a string.
 */
function decrypt(text) {
  if (!text || typeof text !== 'string' || !text.includes(':')) return text;
  
  if (!cachedKey) {
    logger.warn('[Crypto] Decryption skipped: ENCRYPTION_KEY unavailable');
    return text;
  }

  try {
    const [ivHex, encryptedHex] = text.split(':');
    if (!ivHex || !encryptedHex) return text;

    const iv = Buffer.from(ivHex, 'hex');
    const encryptedText = Buffer.from(encryptedHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', cachedKey, iv);
    
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString();
  } catch (err) {
    // 🛡️ [SEC-FIX] Strict Decryption Enforcement
    // Never fallback to plain text in production to prevent PII exposure
    logger.error('🚨 [CRITICAL] Decryption failure detected. Data may be corrupt or key mismatch.', { error: err.message });
    throw new Error(`DECRYPTION_FAILED: ${err.message}`);
  }
}

/**
 * 🛡️ Blind Indexing (Hashing with secret pepper)
 * Allows searching/uniqueness check on encrypted fields.
 */
function hashBlind(text) {
  if (!text) return text;
  
  if (!cachedKey) {
    logger.error('🚨 [CRITICAL] Hashing failed: ENCRYPTION_KEY is missing');
    throw new Error('HASHING_KEY_UNAVAILABLE');
  }

  try {
    return crypto.createHmac('sha256', cachedKey)
      .update(String(text))
      .digest('hex');
  } catch (err) {
    logger.error('🚨 [CRITICAL] Hashing failure detected.', { error: err.message });
    throw new Error(`HASHING_FAILED: ${err.message}`);
  }
}

module.exports = { encrypt, decrypt, hashBlind };

