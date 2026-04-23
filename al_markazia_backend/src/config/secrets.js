// src/config/secrets.js
/**
 * 🛡️ Single Source of Truth for all sensitive secrets.
 * Crashes the process at startup if any required secret is missing or insecure.
 */

// Bypass validation for specific build/seed scripts if necessary
if (process.env.SKIP_SECRETS_VALIDATION === 'true') {
  module.exports = {
    JWT_SECRET: process.env.JWT_SECRET || 'bypass',
    REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || 'bypass',
    ACCESS_TOKEN_EXPIRY: '15m',
    REFRESH_TOKEN_EXPIRY: '7d',
    REFRESH_TOKEN_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000
  };
  return;
}

const REQUIRED_SECRETS = [
  'JWT_SECRET',
  'REFRESH_TOKEN_SECRET',
  'DATABASE_URL'
];

function validateSecrets() {
  const missing = [];
  
  for (const key of REQUIRED_SECRETS) {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.error('═══════════════════════════════════════════════════════');
    console.error('❌ FATAL: Missing required environment variables:');
    missing.forEach(k => console.error(`   • ${k}`));
    console.error('   Refer to .env.example for the required format.');
    console.error('═══════════════════════════════════════════════════════');
    process.exit(1);
  }

  // Extra check: secrets must not be the well-known placeholders
  const forbiddenValues = [
    'your-access-secret-key-change-it',
    'your-refresh-secret-key-change-it',
    'your_secret_here',
    'changeme',
    'secret'
  ];

  for (const key of REQUIRED_SECRETS) {
    const val = process.env[key];
    if (forbiddenValues.includes(val)) {
      console.error(`❌ FATAL: ${key} is set to a well-known placeholder value. You MUST change it.`);
      process.exit(1);
    }
  }

  // Minimum entropy check for JWT secrets (Production/Staging hardening)
  if (process.env.JWT_SECRET.length < 32) {
    console.error('❌ FATAL: JWT_SECRET must be at least 32 characters long for security.');
    process.exit(1);
  }

  if (process.env.REFRESH_TOKEN_SECRET.length < 32) {
    console.error('❌ FATAL: REFRESH_TOKEN_SECRET must be at least 32 characters long.');
    process.exit(1);
  }
  
  if (process.env.JWT_SECRET === process.env.REFRESH_TOKEN_SECRET) {
    console.error('❌ FATAL: JWT_SECRET and REFRESH_TOKEN_SECRET must be different.');
    process.exit(1);
  }
}

validateSecrets();

module.exports = {
  JWT_SECRET: process.env.JWT_SECRET,
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET,
  // Single source of truth for expiries to ensure DB & JWT sync
  ACCESS_TOKEN_EXPIRY: process.env.ACCESS_TOKEN_EXPIRY || '15m',
  REFRESH_TOKEN_EXPIRY: process.env.REFRESH_TOKEN_EXPIRY || '7d',
  REFRESH_TOKEN_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000 // Keep in sync with REFRESH_TOKEN_EXPIRY
};
