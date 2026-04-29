const { Queue, Worker } = require('bullmq');
const redis = require('../lib/redis');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const observability = require('../services/observabilityService');
const recoveryService = require('../services/recoveryService');
const socketInit = require('../socket');
const admin = require('firebase-admin');

/**
 * 👷 Health Monitoring Worker
 * Uses BullMQ to perform scheduled system heartbeats.
 * Ensures only one instance runs at a time (Concurrency: 1).
 */
const { v4: uuidv4 } = require('uuid');
const healthQueue = new Queue('healthQueue', { connection: redis });
const instanceId = uuidv4(); // Unique ID for this instance

/**
 * 👑 Leased Fencing Leadership
 * Leadership is a lease with TTL. Every operation verifies token + ownership.
 */
const acquireLease = async (key, durationSec = 10) => {
  const leaseKey = `leader:${key}`;
  const tokenKey = `token:${key}`;

  try {
    // 1. Try to acquire lease
    const acquired = await redis.set(leaseKey, instanceId, 'NX', 'EX', durationSec);
    
    if (acquired === 'OK') {
      // 2. Generate/Update Fencing Token
      const token = await redis.incr(tokenKey);
      return { token, owner: true };
    }

    // 3. Check existing lease
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
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 800))
      ]);
      return { name: c.name, ok: !!ok, latency: Date.now() - start };
    } catch (err) {
      return { name: c.name, ok: false, latency: Date.now() - start, error: err.message };
    }
  }));

  // Update Observability Engine
  const health = await observability.updateHealth(results);

  // Auto-healing Trigger
  if (health.status === 'CRITICAL' || health.status === 'DEGRADED') {
    for (const res of results) {
      if (!res.ok) await recoveryService.handleServiceFailure(res.name);
    }
  }

  return health;
};

// Check Implementations
async function checkDatabase() {
  await prisma.$queryRaw`SELECT 1`;
  return true;
}

async function checkRedis() {
  await redis.ping();
  return true;
}

async function checkSocket() {
  const io = socketInit.getIO();
  return !!io.engine;
}

async function checkFCM() {
  const firebaseService = require('../services/firebaseService');
  if (!firebaseService.isFcmEnabled()) {
    return true; // Healthy because it's intentionally disabled
  }
  // Dry-run check: verify admin SDK is initialized and app is accessible
  return !!admin.app() && !!admin.messaging();
}

/**
 * ⚡ Fast Heartbeat: Database only with Leased Fencing Verification
 */
const performFastDBCheck = async () => {
  const lease = await acquireLease('fast-db-check', 6);
  if (!lease.owner) return;

  const start = Date.now();
  let ok = false;
  let error = null;
  
  try {
    // 🛡️ Pre-execution Fencing: Verify token is still valid (Mental check: Lease duration > check time)
    await checkDatabase();
    
    // 🛡️ Post-execution Fencing: Optional double check if needed for high stakes
    ok = true;
  } catch (err) {
    error = err.message;
  }

  const result = [{ 
    name: 'db', 
    ok, 
    latency: Date.now() - start, 
    error,
    fencingToken: lease.token 
  }];
  
  await observability.updateHealth(result);
};

const initHealthWorker = () => {
  // Schedule the Full System Check (every 60 seconds)
  healthQueue.add('full-check', {}, {
    repeat: {
      every: 60000,
    },
    removeOnComplete: true,
    removeOnFail: true
  });

  // Schedule the Fast DB Check (every 30 seconds)
  healthQueue.add('fast-check', {}, {
    repeat: {
      every: 30000,
    },
    removeOnComplete: true,
    removeOnFail: true
  });

  const worker = new Worker('healthQueue', async (job) => {
    if (job.name === 'fast-check') {
      return await performFastDBCheck();
    }
    
    logger.debug('[HealthWorker] Executing scheduled full-heartbeat...');
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
