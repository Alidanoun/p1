const { Queue, Worker } = require('bullmq');
const redis = require('../lib/redis');
const logger = require('../utils/logger');
const prisma = require('../lib/prisma');

/**
 * 📦 Order Lifecycle Queue (BullMQ)
 * Handles timeouts, delayed tasks, and automated SLA enforcement.
 */
const orderQueue = new Queue('order-lifecycle', {
  connection: redis.duplicate(),
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: { age: 86400 } // Keep failed jobs for 24 hours
  }
});

/**
 * 🛠️ Order Lifecycle Worker
 */
const initOrderWorker = (container) => {
  const worker = new Worker('order-lifecycle', async (job) => {
    const { orderId, type } = job.data;
    
    logger.info(`[OrderWorker] Processing job: ${job.name}`, { orderId, type });

    if (job.name === 'auto-timeout') {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      
      // Only timeout if still PENDING or WAITING_CANCELLATION
      if (order && (order.status === 'pending' || order.status === 'waiting_cancellation')) {
        const contractGateway = require('../services/contractGateway');
        
        const { v4: uuidv4 } = require('uuid');
        await contractGateway.execute(orderId, 'SYSTEM_CANCEL', {
          reason: 'AUTO_TIMEOUT: No response within the allowed operational window.',
          idempotencyKey: `timeout_${orderId}_${uuidv4()}`
        }, { id: 'SYSTEM', role: 'system' });
        
      }
    }

    if (job.name === 'replacement-timeout') {
      const { itemId } = job.data;
      const orderItem = await prisma.orderItem.findUnique({
        where: { id: itemId }
      });
      
      if (orderItem && orderItem.status === 'pending_replacement_approval') {
        const contractGateway = require('../services/contractGateway');
        const { v4: uuidv4 } = require('uuid');
        
        await contractGateway.execute(orderId, 'RESPOND_REPLACEMENT', {
          itemId,
          accept: false,
          preference: 'DEDUCT_FROM_BILL',
          idempotencyKey: `timeout_replacement_${orderId}_${itemId}_${uuidv4()}`
        }, { id: 'SYSTEM', role: 'system' });
        
        logger.warn(`[OrderWorker] Replacement timeout for item ${itemId} in order #${orderId} expired. Cancelled and deducted.`);
      }
    }
  }, {
    connection: redis.duplicate(),
    concurrency: 5
  });

  worker.on('failed', (job, err) => {
    logger.error(`[OrderWorker] Job ${job.id} failed`, { error: err.message });
  });

  return worker;
};

const setupQueueDashboard = (app) => {
  // Placeholder for future BullBoard integration
  logger.info('[OrderQueue] Dashboard initialized (Placeholder)');
};

module.exports = { orderQueue, initOrderWorker, setupQueueDashboard };
