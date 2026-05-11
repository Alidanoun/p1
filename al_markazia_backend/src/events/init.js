const logger = require('../utils/logger');
const distributedBus = require('./distributedEventBus');
const container = require('../lib/container');
const { subscriber } = require('../lib/redis');

/**
 * 🛰️ Global Event System Initializer (SDS 2.0)
 */
async function init() {
  try {
    // 1. 📥 Initialize Global Distributed Fabric Listener
    // This connects Redis Pub/Sub to the local application logic
    await distributedBus.subscribe(async (event) => {
      // Forward global events to the local event bus (EventEmitter)
      // This allows local handlers (like SocketHandler) to remain decoupled
      const localBus = require('./eventBus');
      localBus.emit(event.type, event);
      
      logger.debug(`[SDS-Backbone] Global event ${event.type} received and routed locally`, { eventId: event.eventId });
    });

    // 2. 💓 Initialize Transactional Wake-up Listener (Outbox Pulse)
    // This instance will wake up and process pending outbox events when it hears a pulse
    await subscriber.subscribe('outbox:pulse');
    subscriber.on('message', async (channel) => {
      if (channel === 'outbox:pulse') {
        logger.debug('[SDS-Backbone] Outbox Pulse received. Dispatching pending events...');
        await container.outboxService.dispatchPending();
      }
    });

    // 3. 🛡️ Safety Net: Periodic Dispatch (Fallback for missed pulses)
    setInterval(() => {
      container.outboxService.dispatchPending().catch(err => {
        logger.error('[SDS-Backbone] Fallback dispatch failed', { error: err.message });
      });
    }, 30000); // Every 30 seconds

    logger.info('🛰️ [SDS-Backbone] Distributed Event Fabric & Outbox Worker Active');
  } catch (err) {
    logger.error('❌ [SDS-Backbone] Initialization failed', { error: err.message });
    throw err;
  }
}

module.exports = { init };
