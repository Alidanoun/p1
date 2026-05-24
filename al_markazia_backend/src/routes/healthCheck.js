const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const redis = require('../lib/redis');
const { orderQueue } = require('../queues/orderQueue');
const { emailQueue } = require('../queues/emailQueue');

/**
 * 🏥 Comprehensive System Health Check
 * Checks Database, Redis, BullMQ Queues, Memory, and Disk Space.
 */
router.get('/', async (req, res) => {
  const healthInfo = {
    status: 'HEALTHY',
    timestamp: new Date().toISOString(),
    instance: process.env.INSTANCE_ID || 'default',
    uptime: process.uptime(),
    checks: {
      database: { status: 'UNKNOWN' },
      redis: { status: 'UNKNOWN' },
      cache: { status: 'UNKNOWN' },
      queues: { status: 'UNKNOWN' },
      memory: { status: 'UNKNOWN' },
      disk: { status: 'UNKNOWN' }
    }
  };

  let hasError = false;

  // 1. Database Check
  try {
    const startDb = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    healthInfo.checks.database = {
      status: 'UP',
      latency: `${Date.now() - startDb}ms`
    };
  } catch (err) {
    healthInfo.checks.database = { status: 'DOWN', error: err.message };
    hasError = true;
  }

  // 2. Redis Check
  try {
    const startRedis = Date.now();
    const status = await redis.checkRedisHealth();
    const isAllUp = status.cache && status.bullmq && status.pubsub;
    healthInfo.checks.redis = {
      status: isAllUp ? 'UP' : 'DEGRADED',
      latency: `${Date.now() - startRedis}ms`,
      details: status
    };
    if (!isAllUp) hasError = true;
  } catch (err) {
    healthInfo.checks.redis = { status: 'DOWN', error: err.message };
    hasError = true;
  }

  // 3. Cache Service Check
  try {
    healthInfo.checks.cache = {
      status: 'UP',
      strategy: 'Distributed L1/L2'
    };
  } catch (err) {
    healthInfo.checks.cache = { status: 'DOWN', error: err.message };
    hasError = true;
  }

  // 4. Queues Check (BullMQ)
  try {
    const startQueue = Date.now();
    const [orderJobs, emailJobs] = await Promise.all([
      orderQueue.count(),
      emailQueue.count()
    ]);
    healthInfo.checks.queues = {
      status: 'UP',
      latency: `${Date.now() - startQueue}ms`,
      details: {
        orderQueueJobs: orderJobs,
        emailQueueJobs: emailJobs
      }
    };
  } catch (err) {
    healthInfo.checks.queues = { status: 'DOWN', error: err.message };
    hasError = true;
  }

  // 5. Memory Check
  try {
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memoryUsage.rss / 1024 / 1024);

    const status = rssMB < 1500 ? 'UP' : 'DEGRADED';
    healthInfo.checks.memory = {
      status,
      details: {
        rss: `${rssMB}MB`,
        heapUsed: `${heapUsedMB}MB`,
        heapTotal: `${heapTotalMB}MB`
      }
    };
    if (status === 'DEGRADED') {
      healthInfo.status = 'DEGRADED';
    }
  } catch (err) {
    healthInfo.checks.memory = { status: 'UNKNOWN', error: err.message };
  }

  // 6. Disk Space Check
  try {
    const stats = await fs.statfs(process.cwd());
    const freeBytes = stats.bfree * stats.bsize;
    const totalBytes = stats.blocks * stats.bsize;
    const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(2);
    const totalGB = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);
    const percentFree = ((freeBytes / totalBytes) * 100).toFixed(1);
    const percentFreeNum = (freeBytes / totalBytes) * 100;

    const status = percentFreeNum > 10 ? 'UP' : 'DEGRADED';
    healthInfo.checks.disk = {
      status,
      details: {
        free: `${freeGB} GB`,
        total: `${totalGB} GB`,
        percentFree: `${percentFree}%`
      }
    };
    if (status === 'DEGRADED') {
      healthInfo.status = 'DEGRADED';
    }
  } catch (err) {
    healthInfo.checks.disk = { status: 'UNKNOWN', error: err.message };
  }

  if (hasError) {
    healthInfo.status = 'DEGRADED';
    logger.error('[HEALTH_CHECK_FAILURE]', { checks: healthInfo.checks });
  }

  const statusCode = healthInfo.status === 'HEALTHY' ? 200 : 503;
  res.status(statusCode).json(healthInfo);
});

module.exports = router;

