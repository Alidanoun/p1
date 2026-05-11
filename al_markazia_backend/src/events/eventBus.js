const EventEmitter = require('events');
const logger = require('../utils/logger');

/**
 * 🌉 Local Event Bus (Dispatcher)
 * This acts as the local transport layer within a single instance.
 * It is fed by the DistributedEventBus (Redis Pub/Sub).
 */
class LocalEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // Prevent memory leak warnings for many subscribers
  }

  /**
   * 📤 Publish an event to local subscribers
   * This is typically called by the DistributedEventBus bridge.
   */
  async publish(event) {
    const { type, payload, metadata } = event;
    
    logger.debug(`[LocalBus] 📤 Dispatching ${type}`, { eventId: metadata?.eventId });
    
    // We use emit() which is synchronous, but handlers can be async.
    // To maintain the 'publish' interface compatibility, we return a resolved promise.
    this.emit(type, { type, payload, metadata });
    return Promise.resolve();
  }

  /**
   * 📬 Compatibility Layer: Alias for 'on'
   */
  subscribe(eventType, handler) {
    this.on(eventType, handler);
    logger.info(`[LocalBus] 📥 New Subscriber for: ${eventType}`);
  }

  /**
   * 🧪 Legacy Alias: emitSafe
   */
  async emitSafe(type, payload = {}) {
    return this.publish({ type, payload, metadata: { source: 'legacy-emit' } });
  }
}

const localBus = new LocalEventBus();

module.exports = localBus;
