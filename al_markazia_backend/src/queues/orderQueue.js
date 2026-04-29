const { Queue, Worker } = require('bullmq');
const redis = require('../lib/redis');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { createBullBoard } = require('@bull-board/api');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');

// 1. Define the Queue
const orderQueue = new Queue('orderQueue', {
  connection: redis,
  limiter: {
    max: 10, // Max 10 orders processed per second globally
    duration: 1000,
  },
});

// 2. Define the Worker (The brain that processes jobs)
const initOrderWorker = (io) => {
  const worker = new Worker(
    'orderQueue',
    async (job) => {
      const { orderId } = job.data;
      const startTime = Date.now();
      
      try {
        logger.info(`[OrderWorker] JOB_START: Order ${orderId}`, { 
          jobId: job.id, 
          attempt: job.attemptsMade + 1 
        });
        
        // 🔐 Distributed Lock: Prevent race condition with Cron cleanup
        const lockKey = `lock:order:autoaccept:${orderId}`;
        const lockAcquired = await redis.set(lockKey, 'worker', 'NX', 'EX', 30);
        if (!lockAcquired) {
          logger.info(`[OrderWorker] Order ${orderId} locked by another processor. Skipping.`);
          return { success: false, reason: 'LOCKED' };
        }

        try {
          // 1. Ensure order exists and is still pending (Avoid ghost jobs)
          const orderExists = await prisma.order.findUnique({ where: { id: orderId } });
          if (!orderExists) {
             logger.warn(`[OrderWorker] Order ${orderId} not found. Cleanly exiting.`, { orderId });
             return { success: false, reason: 'NOT_FOUND' };
          }
          if (orderExists.status !== 'pending') {
             logger.info(`[OrderWorker] Order ${orderId} already ${orderExists.status}. Skipping.`);
             return { success: false, reason: 'ALREADY_PROCESSED' };
          }

          // 🛡️ Architecture Fix: Use Service directly (never import Controllers in Workers)
          const orderService = require('../services/orderService');
          const result = await orderService.updateOrderStatus(orderId, 'preparing');
          
          if (!result) {
            logger.info(`[OrderWorker] Auto-accept SKIPPED for order ${orderId} (Already processed or not pending)`);
            return { success: false, reason: 'ALREADY_PROCESSED' };
          }

          const duration = Date.now() - startTime;
          logger.info(`[OrderWorker] JOB_SUCCESS: Order ${orderId}`, { 
            jobId: job.id, 
            duration: `${duration}ms` 
          });
          return { success: true };
        } finally {
          // Always release the lock with confirmation
          try {
            const deleted = await redis.del(lockKey);
            logger.debug(`[OrderWorker] Lock released for ${orderId}`, { wasLocked: deleted === 1 });
          } catch (lockErr) {
            logger.error(`[OrderWorker] Lock release failed for ${orderId}`, { error: lockErr.message });
          }
        }

      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(`[OrderWorker] JOB_FAILED: Order ${orderId}`, { 
          jobId: job.id,
          attempt: job.attemptsMade + 1,
          error: error.message,
          duration: `${duration}ms`
        });
        throw error; // Rethrow to trigger BullMQ retry strategy
      }
    },
    {
      connection: redis,
      concurrency: 5,
    }
  );

  worker.on('completed', (job) => {
    logger.info(`[OrderWorker] Job completed: ${job.id}`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[OrderWorker] Job failed: ${job?.id}`, { error: err.message, attempts: job?.attemptsMade });
  });

  return worker;
};

// 3. Define the UI Dashboard
const setupQueueDashboard = () => {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [new BullMQAdapter(orderQueue)],
    serverAdapter: serverAdapter,
  });

  return serverAdapter.getRouter();
};

module.exports = {
  orderQueue,
  initOrderWorker,
  setupQueueDashboard,
};
