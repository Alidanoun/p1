const redis = require('../src/lib/redis');
const logger = require('../src/utils/logger');

async function enableSecurityFeatures() {
  const flags = {
    'ENFORCE_BRANCH_ISOLATION': true,
    'ENFORCE_USER_STATUS_CHECK': true,
    'BRANCH_AWARE_SOCKET_ROOMS': true,
    'CSRF_STRICT_MODE': true,
    'DEVICE_FINGERPRINT_TOLERANCE': false, // Tighten security: No tolerance for mismatched fingerprints
  };

  logger.info('🚀 Activating Enterprise Security Features...');

  for (const [flag, enabled] of Object.entries(flags)) {
    const payload = { 
      enabled, 
      updatedAt: new Date().toISOString(),
      activatedBy: 'Antigravity_Security_Audit'
    };
    await redis.set(`feature:${flag}`, JSON.stringify(payload));
    logger.info(`✅ Feature '${flag}' is now ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  logger.info('🎉 All security hardening layers are now ACTIVE.');
  process.exit(0);
}

enableSecurityFeatures().catch(err => {
  console.error('Failed to enable flags:', err);
  process.exit(1);
});
