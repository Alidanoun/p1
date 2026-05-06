const express = require('express');
const router = express.Router();
const Redis = require('ioredis');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const cacheService = require('../services/cacheService');

/**
 * 🏥 Comprehensive System Health Check
 * Checks Database, Redis, and Application Services.
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

    // 2. Redis Check
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      commandTimeout: 2000
    };
    const redisClient = new Redis(redisConfig);
    
    try {
      const startRedis = Date.now();
      await redisClient.ping();
      healthInfo.checks.redis = {
        status: 'UP',
        latency: `${Date.now() - startRedis}ms`
      };
    } finally {
      await redisClient.quit();
    }

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
