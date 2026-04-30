const { Queue, Worker } = require('bullmq');
const redis = require('../lib/redis');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const observability = require('../services/observabilityService');
const recoveryService = require('../services/recoveryService');
const socketInit = require('../socket');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

const healthQueue = new Queue('healthQueue', { connection: redis });
const instanceId = uuidv4();

/**
 * 👑 Leased Fencing Leadership
 */
const acquireLease = async (key, durationSec = 10) => {
  const leaseKey = `leader:${key}`;
  const tokenKey = `token:${key}`;
  try {
    const acquired = await redis.set(leaseKey, instanceId, 'NX', 'EX', durationSec);
    if (acquired === 'OK') {
      const token = await redis.incr(tokenKey);
      return { token, owner: true };
    }
    const currentOwner = await redis.get(leaseKey);
    const token = await redis.get(tokenKey);
    return { 
      token: parseInt(token || '0'), 
      owner: currentOwner === instanceId 
    };
  } catch (err) {
    return { token: 0, owner: false };
  }
};

const performHealthChecks = async () => {
  const checks = [
    { name: 'db', fn: checkDatabase },
    { name: 'redis', fn: checkRedis },
    { name: 'socket', fn: checkSocket },
    { name: 'fcm', fn: checkFCM }
  ];

  const results = await Promise.all(checks.map(async (c) => {
    const start = Date.now();
    try {
      const ok = await Promise.race([
        c.fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1500)) // Increased timeout
      ]);
      return { name: c.name, ok: !!ok, latency: Date.now() - start };
    } catch (err) {
      return { name: c.name, ok: false, latency: Date.now() - start, error: err.message };
    }
  }));

  const health = await observability.updateHealth(results);

  if (health.status === 'CRITICAL' || health.status === 'DEGRADED') {
    for (const res of results) {
      if (!res.ok) await recoveryService.handleServiceFailure(res.name);
    }
  }

  return health;
};

async function checkDatabase() {
  await prisma.$queryRaw`SELECT 1`;
  return true;
}

async function checkRedis() {
  await redis.ping();
  return true;
}

async function checkSocket() {
  try {
    const io = socketInit.getIO();
    return !!io;
  } catch (err) {
    return false;
  }
}

async function checkFCM() {
  try {
    const firebaseService = require('../services/firebaseService');
    if (!firebaseService.isFcmEnabled()) return true;
    return !!admin.app() && !!admin.messaging();
  } catch (err) {
    return false;
  }
}

const initHealthWorker = async () => {
  try {
    // 🧹 CLEANUP: Clear existing repeat jobs to prevent "Zombie Job Storm"
    const repeatableJobs = await healthQueue.getRepeatableJobs().catch(() => []);
    for (const job of repeatableJobs) {
      await healthQueue.removeRepeatableByKey(job.key).catch(() => {});
    }

    // 1. Full Check - Every 60s
    await healthQueue.add('full-check', {}, {
      repeat: { every: 60000 },
      removeOnComplete: true,
      removeOnFail: true
    });

    // 2. Fast Check - Every 30s
    await healthQueue.add('fast-check', {}, {
      repeat: { every: 30000 },
      removeOnComplete: true,
      removeOnFail: true
    });
  } catch (err) {
    logger.warn('[HealthWorker] ⚠️ Failed to initialize repeat jobs. Will retry on next heartbeat.', { error: err.message });
  }

  const worker = new Worker('healthQueue', async (job) => {
    // 🛡️ Distributed Lease Guard: Only one instance processes the check
    const lease = await acquireLease(job.name, 15);
    if (!lease.owner) return;

    logger.debug(`[HealthWorker] Processing ${job.name} (Lease: ${lease.token})`);
    
    if (job.name === 'fast-check') {
      await checkDatabase();
      return;
    }
    
    return await performHealthChecks();
  }, { 
    connection: redis,
    concurrency: 1, 
  });

  return worker;
};

module.exports = {
  healthQueue,
  initHealthWorker,
  performHealthChecks
};
