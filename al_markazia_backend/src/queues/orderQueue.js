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
      
      try {
        logger.info(`OrderWorker: Processing auto-accept for order ${orderId}`);
        
        // --- High-Throughput Hardening ---
        // 1. Ensure order exists (Avoid ghost jobs)
        const orderExists = await prisma.order.findUnique({ where: { id: orderId } });
        if (!orderExists) {
           logger.warn(`OrderWorker: Order ${orderId} not found. Cleanly exiting.`, { orderId });
           return { success: false, reason: 'NOT_FOUND' };
        }

        // Require the controller helper to update with side effects (Socket/Notifications)
        const { performStatusUpdate } = require('../controllers/orderController');
        
        // 🛡️ User Request: Use the atomic status update helper
        const result = await performStatusUpdate(orderId, 'preparing', io);
        
        if (!result) {
          logger.info(`OrderWorker: Auto-accept SKIPPED for order ${orderId} (Already processed or not pending)`);
          return { success: false, reason: 'ALREADY_PROCESSED' };
        }

        logger.info(`OrderWorker: Auto-accept SUCCESS for order ${orderId}`);
        return { success: true };

      } catch (error) {
        logger.error('OrderWorker: Job failed', { orderId, error: error.message });
        throw error; // Rethrow to trigger BullMQ retry strategy
      }
    },
    {
      connection: redis,
      concurrency: 25, // Optimized for 10-20 concurrent user bursts
    }
  );

  worker.on('completed', (job) => {
    logger.info(`Job completed: ${job.id}`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job failed: ${job?.id}`, { error: err.message });
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
