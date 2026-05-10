// src/config/secrets.js
/**
 * 🛡️ Single Source of Truth for all sensitive secrets.
 * Crashes the process at startup if any required secret is missing or insecure.
 */

// Bypass validation for specific build/seed scripts if necessary
if (process.env.NODE_ENV !== 'production' && process.env.SKIP_SECRETS_VALIDATION === 'true') {
  module.exports = {
    JWT_SECRET: process.env.JWT_SECRET || 'bypass_secret_key_32_chars_long_long_long',
    REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || 'bypass_refresh_key_32_chars_long_long',
    JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDA1JC54OGgdtEx\n6jcliqMjlpsNTgQTiUkceoxcmCgawymh5i5vum/wEU4IcMGwghmYaN1ridmXOvuy\nXSiHoS+kq+zxl1r5AW41Gw85AuvLrV0JaJZ08LUldYwCTZOqutmGSIyKMxkHG1jS\nx2fvYcCoTFCyRoxCo3cl51HcccTpQhNna6WXMZh5wOc/NXT6ma5z57VpOlysyq13\nmIoLHIEo8XKNBO5E+rBnchrq09qhefnBOGL1+ejNQM39TPjVTVIAG2BtjN7fn80s\nmKiiXLAOp2jeI+kQeTJMYtiGwuoLah6PLicSabu3nygbgpINWIyBEDHD+yMX37mF\niqYsxm2RAgMBAAECggEAAeEwkKHzYRaMvyalfKKyKL3Q63DIE7lXXUUz4A/a+Dkl\nyz5h/n8mlIRT/+YQJUcnYQ0d92yOZ+3QbUfWMM2ZQsrVkkdOQODK27lUon13ofJ3\nK955SlDcWy30UZjC/eY4tO6OcXxtBoeK4UcbVBczrbr3YGgqpC2mvYJYkcRezdft\ni/HWsGa13raUuMaDML5smBX8IOWOCQH09MaYHicYCnF9gVwYsWp5nwNowog5da49\nmHy8x8FtN8XA1d8n4C1Bn8yPisWXQ/3mNdo/2qX90pCs3DfSTayAyvV9BOd3Y+QI\nhOmFj41ODs1emSd01t6/5P1VXUFp8MVZjXbHR3j2rwKBgQDeYoW5GJv7tmt7KTf7\nmho1/mxwpl5EVyfxlJoaSYfuu/KgLyjKooK9K8qLZbMd2nkQ3lK7RyruLwd8Xox4\nE8BNtzwxY/6qKMdeAJ4HdJ21ZsdB1YqTbJTjNVgSK+1kpSWzg2TBAi22+4Svs64D\nyrBEeXbPK6vz7nZxLd54Jt75GwKBgQDd+mQ74GcnC69piehh9w9UuRtGRykyOS/f\nUy2hv6AdmRA1Er+7o97bMZ/FPc3bNEGEWGDFvY14Xh5cH2PVxyzJn0nok2uYMiM5\nGxkAl+9HX3pUfhLhfzxZdRngtmgjJOl9CLKzk0KnQT3od5IJfNx4fTBisWCJlgbG\nC81Gs3TqwwKBgQC52JoqSo+otxVxksvPP0SiVOJo7hAfirq94FM8nrCz6WvlRCQR\n2+fokZ0uC6q5yyeb2kBHdD1DWhgmbplzjAYMrJHoMMnViEi8nUVzs5hMzfy9Xuj1\nNSvkCWN1pDI7BuzP7YGY7uonXmDPuRg24P+X6e5JShTkwSdIhG3D+bAjewKBgGZ+\nGpHbB0XsC047suSo4pdH8OP+L3NVHFmNWmB4zkFcTzNyOL026MtkmlTEOKyh8C5f\ncC9dWljdfD8k7z/h+zgNKF8O0nsvizvu2xh/Dqhx2VXx8F3WFdNoUk6DaonvnS9y\nOLDZqcj4QtF3hCKFWHb5tsGbDOv6LZ58DIg8jBtpAoGAXsv+a7ohZdfgxhlSclR9\nbOp5wb/8+w+1DvjaPBx1opaez/ISYRiicK6PmuUeKMLEcuUsS2s6Otdh47CbLMEH\niAdfjWPZQZtdzqKHDuG5mK6Z/MyuReohlxP62LA+oNxS1vGJ+Q4fJPvs92l6SCjC\nDJw2YhJxfdMFJ8iPXcHrjhQ=\n-----END PRIVATE KEY-----',
    JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwNSQueDhoHbRMeo3JYqj\nI5abDU4EE4lJHHqMXJgoGsMpoeYub7pv8BFOCHDBsIIZmGjda4nZlzr7sl0oh6Ev\npKvs8Zda+QFuNRsPOQLry61dCWiWdPC1JXWMAk2TqrrZhkiMijMZBxtY0sdn72HA\nqExQskaMQqN3JedR3HHE6UITZ2ullzGYecDnPzV0+pmuc+e1aTpcrMqtd5iKCxyB\nKPFyjQTuRPqwZ3Ia6tPaoXn5wThi9fnozUDN/Uz41U1SABtgbYze35/NLJioolyw\nDqdo3iPpEHkyTGLYhsLqC2oejy4nEmm7t58oG4KSDViMgRAxw/sjF9+5hYqmLMZt\nkQIDAQAB\n-----END PUBLIC KEY-----',
    ACCESS_TOKEN_EXPIRY: '15m',
    REFRESH_TOKEN_EXPIRY: '7d',
    REFRESH_TOKEN_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000
  };
} else {
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

const ms = require('ms');

module.exports = {
  JWT_SECRET: process.env.JWT_SECRET,
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET,
  JWT_PRIVATE_KEY: process.env.JWT_PRIVATE_KEY ? process.env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
  JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY ? process.env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n') : '',
  // Single source of truth for expiries to ensure DB & JWT sync
  ACCESS_TOKEN_EXPIRY: process.env.ACCESS_TOKEN_EXPIRY || '15m',
  REFRESH_TOKEN_EXPIRY: process.env.REFRESH_TOKEN_EXPIRY || '7d',
  REFRESH_TOKEN_EXPIRY_MS: ms(process.env.REFRESH_TOKEN_EXPIRY || '7d'),
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS || '12', 10)
  };
}
