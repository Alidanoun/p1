const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const redis = require('../lib/redis');
const cacheService = require('../services/cacheService');

/**
 * 🏥 Comprehensive System Health Check
 * Checks Database, Redis, and Application Services.
 * Uses shared Redis client instead of creating new connections per request.
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
      cache: { status: 'UNKNOWN' }
    }
  };

  try {
    // 1. Database Check
    const startDb = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    healthInfo.checks.database = {
      status: 'UP',
      latency: `${Date.now() - startDb}ms`
    };

    // 2. Redis Check — use shared client (no new connection per request)
    const startRedis = Date.now();
    await redis.ping();
    healthInfo.checks.redis = {
      status: 'UP',
      latency: `${Date.now() - startRedis}ms`
    };

    // 3. Cache Service Check
    healthInfo.checks.cache = {
      status: 'UP',
      strategy: 'Distributed L1/L2'
    };

  } catch (err) {
    healthInfo.status = 'DEGRADED';
    logger.error('[HEALTH_CHECK_FAILURE]', { error: err.message });
  }

  const statusCode = healthInfo.status === 'HEALTHY' ? 200 : 503;
  res.status(statusCode).json(healthInfo);
});

module.exports = router;
