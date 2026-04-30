// src/queues/emailQueue.js
const { Queue, Worker } = require('bullmq');
const redis = require('../lib/redis');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

/**
 * 📨 Enterprise Email Queue
 */
const emailQueue = new Queue('email-queue', {
  connection: redis.options, // Reuse existing connection options
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s initial delay
    },
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 }, // Keep failed jobs for 24h
  },
});

/**
 * 👷 Worker: Processes email jobs in the background
 */
const emailWorker = new Worker(
  'email-queue',
  async (job) => {
    const { type, email, code, purpose } = job.data;
    
    logger.info(`👷 [Email Worker] Processing job ${job.id} for ${email}...`);

    switch (type) {
      case 'otp':
        const success = await emailService.sendOtp(email, code);
        if (!success) throw new Error('Failed to send OTP email');
        break;
        
      case 'password_reset':
        const resetSuccess = await emailService.sendPasswordResetOtp(email, code);
        if (!resetSuccess) throw new Error('Failed to send Reset OTP email');
        break;

      default:
        logger.warn(`⚠️ [Email Worker] Unknown job type: ${type}`);
    }
  },
  { 
    connection: redis.options,
    concurrency: 5 // Process up to 5 emails simultaneously
  }
);

// --- 🎧 Worker Event Listeners ---

emailWorker.on('completed', (job) => {
  logger.info(`✅ [Email Queue] Job ${job.id} completed successfully.`);
});

emailWorker.on('failed', (job, err) => {
  logger.error(`❌ [Email Queue] Job ${job.id} failed after ${job.attemptsMade} attempts: ${err.message}`);
});

/**
 * 🚀 Public Helper: Add OTP to queue
 */
const addOtpToQueue = async (email, code, purpose = 'login') => {
  await emailQueue.add(`otp-${email}-${Date.now()}`, {
    type: 'otp',
    email,
    code,
    purpose
  });
};

/**
 * 🚀 Public Helper: Add Password Reset to queue
 */
const addPasswordResetToQueue = async (email, code) => {
  await emailQueue.add(`reset-${email}-${Date.now()}`, {
    type: 'password_reset',
    email,
    code
  });
};

module.exports = {
  emailQueue,
  addOtpToQueue,
  addPasswordResetToQueue
};
