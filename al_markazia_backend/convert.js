const fs = require('fs');
const { execSync } = require('child_process');

try {
  const out = execSync('npx @dotenvx/dotenvx get -f .env.production').toString();
  const data = JSON.parse(out);
  
  const allowedKeys = [
    'NODE_ENV', 'PORT', 'TIMEZONE', 'ADMIN_PANEL_URL', 'CLIENT_APP_URL',
    'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'DATABASE_URL',
    'REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD', 'REDIS_URL', 'REDIS_USERNAME',
    'REDIS_WORKER_PASSWORD', 'REDIS_WORKER_USERNAME',
    'JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'ENCRYPTION_KEY', 'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY',
    'ACCESS_TOKEN_EXPIRY', 'REFRESH_TOKEN_EXPIRY', 'BCRYPT_ROUNDS',
    'RATE_LIMIT_LOGIN_MAX', 'RATE_LIMIT_LOGIN_WINDOW_MS', 'RATE_LIMIT_GLOBAL_MAX', 'RATE_LIMIT_GLOBAL_WINDOW_MS',
    'CORS_ALLOWED_ORIGINS', 'CORS_ORIGIN',
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME',
    'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
    'SENTRY_DSN', 'SENTRY_ENVIRONMENT',
    'UPLOAD_STORAGE_PROVIDER', 'MAX_FILE_SIZE_MB', 'ALLOWED_FILE_TYPES',
    'ENABLE_REALTIME_METRICS_BROADCAST', 'ENABLE_PESSIMISTIC_FINANCIAL_LOCKING', 'ENABLE_STRICT_DEVICE_FINGERPRINT_BINDING',
    'SKIP_SECRETS_VALIDATION'
  ];
  
  let env = '';
  for (let k in data) {
    if (allowedKeys.includes(k)) {
      let val = String(data[k]).replace(/\n/g, '\\n');
      env += k + '="' + val + '"\n';
    }
  }
  
  fs.writeFileSync('.env.docker', env);
  const b64 = fs.readFileSync('.env.docker').toString('base64');
  fs.writeFileSync('b64.txt', b64);
  console.log('Success');
} catch (e) {
  console.error(e);
}
