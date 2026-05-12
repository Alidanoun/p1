// src/config/secretProvider.js
const logger = require('../utils/logger');

/**
 * 🛡️ Dynamic Secret Provider Abstraction Layer
 * Supports progressive enhancement: Local Env -> In-Memory Cache -> Vault/AWS/GCP Secrets Manager.
 */
class SecretProvider {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Retrieves a secret dynamically.
   * @param {string} keyName 
   * @returns {Promise<string>}
   */
  async getSecret(keyName) {
    // 1. Check in-memory cache
    if (this.cache.has(keyName)) {
      return this.cache.get(keyName);
    }

    // 2. Check external cloud providers (Vault/AWS/GCP) if configured
    // Placeholder for enterprise plugin integration
    
    // 3. Fallback to process.env
    const value = process.env[keyName];
    if (value !== undefined) {
      this.cache.set(keyName, value);
    }

    return value;
  }

  /**
   * Synchronous retrieval helper for immediate startup configs.
   * @param {string} keyName 
   * @returns {string}
   */
  getSecretSync(keyName) {
    if (this.cache.has(keyName)) {
      return this.cache.get(keyName);
    }
    const value = process.env[keyName];
    if (value !== undefined) {
      this.cache.set(keyName, value);
    }
    return value;
  }
}

module.exports = new SecretProvider();
