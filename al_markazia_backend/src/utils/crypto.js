const crypto = require('crypto');
const logger = require('./logger');

/**
 * 🔒 Enterprise Encryption Utility (AES-256-GCM)
 * Authenticated encryption with backward compatibility for AES-256-CBC.
 * Used to protect PII (Personally Identifiable Information) in the database.
 */

const ALGORITHM = 'aes-256-gcm';
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const GCM_PREFIX = 'gcm:';

const rawKey = process.env.ENCRYPTION_KEY;
const rawSalt = process.env.ENCRYPTION_SALT || 'al-markazia-enterprise-v2-scrypt-kdf-salt-2026-production';

/**
 * 🛡️ Validates key existence and length.
 * This is called by the envValidator, but we also check here as a safety net.
 */
function getEncryptionKey() {
  if (!rawKey || rawKey.length < 32) {
    throw new Error('CRITICAL_SECURITY_ERROR: ENCRYPTION_KEY is missing or too weak (min 32 chars).');
  }
  return crypto.scryptSync(rawKey, rawSalt, 32);
}

let cachedKey = null;
try {
  cachedKey = getEncryptionKey();
} catch (e) {
  // We don't exit here to allow the envValidator to give a pretty error message first.
  // But subsequent calls to encrypt/decrypt will fail if cachedKey is null.
}

/**
 * Check if a value is already encrypted with GCM format: gcm:iv:ciphertext:tag
 */
function isEncryptedGCM(val) {
  if (typeof val !== 'string' || !val.startsWith(GCM_PREFIX)) return false;
  const parts = val.split(':');
  if (parts.length !== 4) return false;
  const ivHex = parts[1];
  const tagHex = parts[3];
  return ivHex.length === 24 && tagHex.length === 32 && /^[0-9a-fA-F]+$/.test(ivHex) && /^[0-9a-fA-F]+$/.test(tagHex);
}

/**
 * Check if a value is already encrypted with legacy CBC format: iv:ciphertext
 */
function isEncryptedCBC(val) {
  if (typeof val !== 'string' || !val.includes(':')) return false;
  const [ivHex] = val.split(':');
  return ivHex.length === 32 && /^[0-9a-fA-F]+$/.test(ivHex);
}

/**
 * 🔐 Encrypts a string using AES-256-GCM with a random 12-byte IV.
 * Format: gcm:iv:ciphertext:authTag
 * [IDEMPOTENT]: Detects if already encrypted to avoid double-encryption.
 */
function encrypt(text) {
  if (!text || typeof text !== 'string') return text;

  // 🛡️ Avoid Double Encryption (both GCM and CBC formats)
  if (isEncryptedGCM(text) || isEncryptedCBC(text)) {
    return text;
  }

  if (!cachedKey) {
    logger.error('🚨 [CRITICAL] Encryption failed: ENCRYPTION_KEY is missing or invalid');
    throw new Error('ENCRYPTION_KEY_UNAVAILABLE');
  }

  try {
    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, cachedKey, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    // Format: gcm:iv:ciphertext:tag
    return `${GCM_PREFIX}${iv.toString('hex')}:${encrypted}:${authTag}`;
  } catch (err) {
    logger.error('🚨 [CRITICAL] Encryption failure detected.', { error: err.message });
    throw new Error(`ENCRYPTION_FAILED: ${err.message}`);
  }
}

/**
 * 🔓 Decrypts a string. Supports both AES-256-GCM (new) and AES-256-CBC (legacy).
 */
function decrypt(text) {
  if (!text || typeof text !== 'string' || !text.includes(':')) return text;

  if (!cachedKey) {
    logger.warn('[Crypto] Decryption skipped: ENCRYPTION_KEY unavailable');
    return text;
  }

  try {
    // New GCM format: gcm:iv:ciphertext:tag
    if (text.startsWith(GCM_PREFIX)) {
      return decryptGCM(text);
    }

    // Legacy CBC format: iv:ciphertext
    return decryptLegacyCBC(text);
  } catch (err) {
    // 🛡️ [SEC-FIX] Strict Decryption Enforcement
    // Never fallback to plain text in production to prevent PII exposure
    logger.error('🚨 [CRITICAL] Decryption failure detected. Data may be corrupt or key mismatch.', { error: err.message });
    throw new Error(`DECRYPTION_FAILED: ${err.message}`);
  }
}

/**
 * Decrypt AES-256-GCM ciphertext
 */
function decryptGCM(ciphertext) {
  const parts = ciphertext.split(':');
  // gcm:iv:ciphertext:tag
  const ivHex = parts[1];
  const encryptedHex = parts[2];
  const tagHex = parts[3];

  if (!ivHex || !encryptedHex || !tagHex) throw new Error('INVALID_GCM_FORMAT');

  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, cachedKey, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Decrypt legacy AES-256-CBC ciphertext (backward compatibility)
 */
function decryptLegacyCBC(text) {
  const [ivHex, encryptedHex] = text.split(':');
  if (!ivHex || !encryptedHex) throw new Error('INVALID_CBC_FORMAT');

  const iv = Buffer.from(ivHex, 'hex');
  const encryptedText = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-cbc', cachedKey, iv);

  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString();
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

