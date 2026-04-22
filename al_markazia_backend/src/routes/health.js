const express = require('express');
const router = express.Router();
const observability = require('../services/observabilityService');
const { performHealthChecks } = require('../queues/healthWorker');
const logger = require('../utils/logger');

/**
 * 🏥 System Health Endpoints
 */

// 1. Basic Health Check (Public/Internal)
router.get('/', async (req, res) => {
  const health = await observability.getLiveStatus();
  
  // Deterministic Status Code
  const statusCode = health.status === 'CRITICAL' ? 503 : 200;
  
  res.status(statusCode).json({
    status: health.status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: health.services
  });
});

// 2. Detailed Metrics (Admin Only)
router.get('/details', async (req, res) => {
  // 🛡️ Security Guard: Require admin key
  const adminKey = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
     return res.status(403).json({ error: 'Unauthorized: Admin Key Required' });
  }

  try {
    const prisma = require('../lib/prisma');
    
    // Fetch last 10 historical logs
    const history = await prisma.healthMetric.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' }
    });

    const live = await observability.getLiveStatus();

    res.json({
      live,
      history,
      process: {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        version: process.version
      }
    });
  } catch (err) {
    logger.error('[HealthRoute] Failed to fetch details', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch observability details' });
  }
});

// 3. Force Trigger Refresh (Admin Only)
router.post('/sync', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
     return res.status(403).json({ error: 'Unauthorized: Admin Key Required' });
  }

  logger.info('[HealthRoute] Manual health sync triggered');
  const results = await performHealthChecks();
  res.json(results);
});

module.exports = router;
