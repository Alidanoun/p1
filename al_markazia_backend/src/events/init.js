const logger = require('../utils/logger');
const distributedBus = require('./distributedEventBus');
const container = require('../lib/container');
const { createSubscriber } = require('../lib/redis');

/**
 * 🛰️ Global Event System Initializer (SDS 3.0: Production-Grade Stream Backbone)
 */
async function init() {
  try {
    // 1. 🚀 Initialize Global Backbone Stream & Consumer Groups
    const streamBackbone = require('./streamBackbone');
    await streamBackbone.initialize();

    // 2. 🥇 Start Priority 1 Consumer: Notification Engine (Decoupled FCM At-least-once delivery)
    const notificationEngineConsumer = require('./consumers/notificationEngineConsumer');
    await notificationEngineConsumer.start();

    // 3. 🥈 Start Priority 2 Consumers: Loyalty Ledger & Inventory Restocker
    const loyaltyLedgerConsumer = require('./consumers/loyaltyLedgerConsumer');
    await loyaltyLedgerConsumer.start();
    const inventoryRestockConsumer = require('./consumers/inventoryRestockConsumer');
    await inventoryRestockConsumer.start();
    const financialRollbackConsumer = require('./consumers/financialRollbackConsumer');
    await financialRollbackConsumer.start();
    const logisticsCleanupConsumer = require('./consumers/logisticsCleanupConsumer');
    await logisticsCleanupConsumer.start();

    // 4. 🥉 Start Priority 3 Consumer: UI Fast Reader (Lightweight visual fan-out)
    const uiFastReaderConsumer = require('./consumers/uiFastReaderConsumer');
    await uiFastReaderConsumer.start();

    // 5. 💓 Initialize Transactional Wake-up Listener (Outbox Pulse)
    const outboxSubscriber = createSubscriber();
    await outboxSubscriber.subscribe('outbox:pulse');
    outboxSubscriber.on('message', async (channel) => {
      if (channel === 'outbox:pulse') {
        logger.debug('[SDS-Backbone] Outbox Pulse received. Writing pending outbox events to Stream Backbone...');
        await container.outboxService.dispatchPending();
      }
    });

    // 6. 🛡️ Safety Net: Periodic Outbox Sweep
    setInterval(() => {
      container.outboxService.dispatchPending().catch(err => {
        logger.error('[SDS-Backbone] Fallback outbox sweep failed', { error: err.message });
      });
    }, 30000);

    // 7. 🎯 Load localized projection handlers
    require('./handlers/orderHandlers');
    require('./handlers/socketHandler');
    require('./handlers/authHandlers');
    require('./handlers/eventToSocketBridge');

    logger.info('🛰️ [SDS-Backbone] Production Stream Backbone, Independent Consumer Groups & Idempotency Guards Active');
  } catch (err) {
    logger.error('❌ [SDS-Backbone] Stream Backbone initialization failed', { error: err.message });
    throw err;
  }
}

module.exports = { init };
