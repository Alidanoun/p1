const logger = require('../utils/logger');

/**
 * 🛡️ Enterprise Environment Validator
 * Ensures all required secrets are present and meet security standards.
 */
class EnvValidator {
  static validate() {
    const required = [
      { key: 'DATABASE_URL', min: 10 },
      { key: 'ENCRYPTION_KEY', min: 32 },
      { key: 'JWT_SECRET', min: 32 },
      { key: 'REFRESH_TOKEN_SECRET', min: 32 },
      { key: 'JWT_PRIVATE_KEY', min: 100 },
      { key: 'JWT_PUBLIC_KEY', min: 100 }
    ];

    const missing = [];
    const weak = [];

    for (const { key, min } of required) {
      const val = process.env[key];
      if (!val) {
        missing.push(key);
      } else if (val.length < min) {
        weak.push({ key, min, actual: val.length });
      }
    }

    if (missing.length > 0 || weak.length > 0) {
      console.error('\n' + '='.repeat(50));
      console.error('🔴 CRITICAL CONFIGURATION ERROR');
      console.error('='.repeat(50));

      if (missing.length > 0) {
        console.error('\n❌ MISSING VARIABLES:');
        missing.forEach(k => console.error(`   - ${k}`));
      }

      if (weak.length > 0) {
        console.error('\n⚠️ WEAK VARIABLES (Security Risk):');
        weak.forEach(w => console.error(`   - ${w.key}: Current length ${w.actual}, Minimum required ${w.min}`));
      }

      console.error('\n💡 REMEDIATION:');
      console.error('   1. Check your .env file.');
      console.error('   2. Ensure all secrets are set and meet length requirements.');
      console.error('   3. Use "openssl rand -hex 32" to generate strong keys.');
      console.error('='.repeat(50) + '\n');

      logger.error('Startup failed due to invalid environment configuration', { missing, weak });
      process.exit(1);
    }

    logger.info('✅ Environment validation passed.');
  }
}

module.exports = EnvValidator;
