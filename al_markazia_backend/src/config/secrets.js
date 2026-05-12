// src/config/secrets.js
const crypto = require('crypto');
const ms = require('ms');
const secretProvider = require('./secretProvider');

/**
 * 🛡️ Single Source of Truth for all sensitive secrets.
 * Supports progressive enhancement, dynamic secret provider integration,
 * graceful Key Rotation (legacy fallback keys), and Ephemeral Dev generation.
 */

// Save hardcoded strings exclusively as fallback legacy verification keys to prevent active sessions mass logout
const LEGACY_JWT_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwNSQueDhoHbRMeo3JYqj\nI5abDU4EE4lJHHqMXJgoGsMpoeYub7pv8BFOCHDBsIIZmGjda4nZlzr7sl0oh6Ev\npKvs8Zda+QFuNRsPOQLry61dCWiWdPC1JXWMAk2TqrrZhkiMijMZBxtY0sdn72HA\nqExQskaMQqN3JedR3HHE6UITZ2ullzGYecDnPzV0+pmuc+e1aTpcrMqtd5iKCxyB\nKPFyjQTuRPqwZ3Ia6tPaoXn5wThi9fnozUDN/Uz41U1SABtgbYze35/NLJioolyw\nDqdo3iPpEHkyTGLYhsLqC2oejy4nEmm7t58oG4KSDViMgRAxw/sjF9+5hYqmLMZt\nkQIDAQAB\n-----END PUBLIC KEY-----';

const isDevOrTest = process.env.NODE_ENV !== 'production';

// Auto-Generation for Dev Environment UX
if (isDevOrTest && (!process.env.JWT_PRIVATE_KEY || !process.env.JWT_SECRET)) {
  console.warn('════════════════════════════════════════════════════════════════════════════');
  console.warn('⚠️ WARNING: Using ephemeral in-memory keys for development. Do not use in production.');
  console.warn('════════════════════════════════════════════════════════════════════════════');

  if (!process.env.JWT_PRIVATE_KEY || !process.env.JWT_PUBLIC_KEY) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    process.env.JWT_PRIVATE_KEY = privateKey;
    process.env.JWT_PUBLIC_KEY = publicKey;
  }

  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  }

  if (!process.env.REFRESH_TOKEN_SECRET) {
    process.env.REFRESH_TOKEN_SECRET = crypto.randomBytes(32).toString('hex');
  }
}

const REQUIRED_SECRETS = [
  'JWT_SECRET',
  'REFRESH_TOKEN_SECRET',
  'DATABASE_URL',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY'
];

function validateSecrets() {
  const missing = [];
  
  for (const key of REQUIRED_SECRETS) {
    const value = secretProvider.getSecretSync(key);
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
    const val = secretProvider.getSecretSync(key);
    if (forbiddenValues.includes(val)) {
      console.error(`❌ FATAL: ${key} is set to a well-known placeholder value. You MUST change it.`);
      process.exit(1);
    }
  }

  // Minimum entropy check for JWT secrets (Production/Staging hardening)
  if (secretProvider.getSecretSync('JWT_SECRET').length < 32) {
    console.error('❌ FATAL: JWT_SECRET must be at least 32 characters long for security.');
    process.exit(1);
  }

  if (secretProvider.getSecretSync('REFRESH_TOKEN_SECRET').length < 32) {
    console.error('❌ FATAL: REFRESH_TOKEN_SECRET must be at least 32 characters long.');
    process.exit(1);
  }
  
  if (secretProvider.getSecretSync('JWT_SECRET') === secretProvider.getSecretSync('REFRESH_TOKEN_SECRET')) {
    console.error('❌ FATAL: JWT_SECRET and REFRESH_TOKEN_SECRET must be different.');
    process.exit(1);
  }
}

validateSecrets();

const rawPrivateKey = secretProvider.getSecretSync('JWT_PRIVATE_KEY') || '';
const rawPublicKey = secretProvider.getSecretSync('JWT_PUBLIC_KEY') || '';

module.exports = {
  JWT_SECRET: secretProvider.getSecretSync('JWT_SECRET'),
  REFRESH_TOKEN_SECRET: secretProvider.getSecretSync('REFRESH_TOKEN_SECRET'),
  JWT_PRIVATE_KEY: rawPrivateKey.replace(/\\n/g, '\n'),
  JWT_PUBLIC_KEY: rawPublicKey.replace(/\\n/g, '\n'),
  LEGACY_JWT_PUBLIC_KEY, // Expose for graceful verification fallback of pre-rotation active sessions
  ACCESS_TOKEN_EXPIRY: secretProvider.getSecretSync('ACCESS_TOKEN_EXPIRY') || '15m',
  ACCESS_TOKEN_EXPIRY_MS: ms(secretProvider.getSecretSync('ACCESS_TOKEN_EXPIRY') || '15m'),
  REFRESH_TOKEN_EXPIRY: secretProvider.getSecretSync('REFRESH_TOKEN_EXPIRY') || '7d',
  REFRESH_TOKEN_EXPIRY_MS: ms(secretProvider.getSecretSync('REFRESH_TOKEN_EXPIRY') || '7d'),
  BCRYPT_ROUNDS: parseInt(secretProvider.getSecretSync('BCRYPT_ROUNDS') || '12', 10)
};
