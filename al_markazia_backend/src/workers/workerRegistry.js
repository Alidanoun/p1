const StreamConsumerGroup = require('../events/streamConsumerGroup');
const loyaltyEventHandler = require('./handlers/loyaltyEventHandler');
const logger = require('../utils/logger');

/**
 * 🏭 Worker Registry
 * Central startup for all Redis Stream Consumer Group workers.
 * Call startWorkers() once during server boot (after Redis is connected).
 * Call stopWorkers() on graceful shutdown (SIGTERM/SIGINT).
 *
 * Consumer Groups registered here must match the names defined in
 * streamBackbone.js CONSUMER_GROUPS array, or they will not consume
 * from the backbone stream.
 */

const workers = [];

async function startWorkers() {
  logger.info('[WorkerRegistry] 🚀 Starting all consumer group workers...');

  // 🎁 Loyalty Ledger Worker
  // Handles at-least-once delivery of loyalty points from the Outbox
  const loyaltyWorker = new StreamConsumerGroup(
    'cg:loyalty_ledger',
    `worker-${process.pid}`, // Unique consumer name per process (supports horizontal scaling)
    {
      'loyalty.order_award':   loyaltyEventHandler.onOrderAward,
      'loyalty.referral_award': loyaltyEventHandler.onReferralAward,
    }
  );

  workers.push(loyaltyWorker);

  // Start all workers in parallel
  await Promise.all(workers.map(w => w.start()));

  logger.info(`[WorkerRegistry] ✅ ${workers.length} worker(s) active.`);
}

function stopWorkers() {
  logger.info('[WorkerRegistry] 🛑 Stopping all consumer group workers...');
  workers.forEach(w => w.stop());
}

module.exports = { startWorkers, stopWorkers };
