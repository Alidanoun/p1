const crypto = require('crypto');
const logger = require('./logger');

/**
 * 🔒 Enterprise Encryption Utility (AES-256-CBC)
 * Used to protect PII (Personally Identifiable Information) in the database.
 */

// Load key from environment
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; 
const IV_LENGTH = 16; // For AES, this is always 16

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
  logger.error('❌ [Crypto] ENCRYPTION_KEY must be at least 32 characters long. Sensitive data protection is compromised.');
}

/**
 * 🔐 Encrypts a string using AES-256-CBC with a random IV.
 * Format: iv:encrypted_data
 */
function encrypt(text) {
  if (!text || typeof text !== 'string') return text;
  
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.substring(0, 32)), iv);
    
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (err) {
    logger.error('[Crypto] Encryption failed', { error: err.message });
    return text;
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
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.substring(0, 32)), iv);
    
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
  return crypto.createHmac('sha256', ENCRYPTION_KEY)
    .update(String(text))
    .digest('hex');
}

module.exports = { encrypt, decrypt, hashBlind };
