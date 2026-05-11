const { publisher, subscriber } = require('../lib/redis');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * 🚌 Distributed Event Bus (SDS 2.0)
 * Uses Redis Pub/Sub as the Real-time Transport Layer.
 * Implements Global Idempotency Guard.
 */
class DistributedEventBus {
  constructor() {
    this.instanceId = uuidv4().split('-')[0]; // Unique ID for this server instance
    this.CHANNEL = 'distributed_events_fabric';
  }

  /**
   * 🚀 Publish: Send event to all instances via Redis
   */
  async publish(type, payload, options = {}) {
    const eventMessage = {
      eventId: options.eventId || uuidv4(),
      type,
      payload,
      aggregateId: options.aggregateId,
      aggregateType: options.aggregateType,
      version: options.version || 1,
      eventSequence: options.eventSequence || 1,
      metadata: options.metadata || {},
      publisherInstance: this.instanceId,
      timestamp: Date.now()
    };

    await publisher.publish(this.CHANNEL, JSON.stringify(eventMessage));
    return eventMessage;
  }

  /**
   * 📥 Subscribe: Listen to global events and run handlers
   */
  async subscribe(onEvent) {
    await subscriber.subscribe(this.CHANNEL, async (message) => {
      try {
        const event = JSON.parse(message);
        
        // 🛡️ [IDEMPOTENCY-GUARD] Check if this instance already processed this event
        const cache = require('../lib/redis').cache;
        const processedKey = `processed_event:${this.instanceId}:${event.eventId}`;
        
        const alreadyProcessed = await cache.get(processedKey);
        if (alreadyProcessed) {
          logger.debug(`[DistributedBus] Skipping duplicate event ${event.eventId}`);
          return;
        }

        // Mark as processed (short TTL to prevent memory leak, but long enough for race conditions)
        await cache.set(processedKey, 'true', 'EX', 300); 

        // Execute local handler (e.g., Socket emission)
        await onEvent(event);

      } catch (err) {
        logger.error('[DistributedBus] Subscription error', { error: err.message });
      }
    });
    
    logger.info(`📡 [DistributedBus] Instance ${this.instanceId} subscribed to Global Fabric`);
  }
}

module.exports = new DistributedEventBus();
