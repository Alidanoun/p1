const logger = require('../utils/logger');

class EventBus {
  constructor() {
    this.handlers = {};
  }

  /**
   * Subscribe a handler to a specific event type.
   */
  subscribe(eventType, handler) {
    if (!this.handlers[eventType]) {
      this.handlers[eventType] = [];
    }
    this.handlers[eventType].push(handler);
    // Use logger to ensure it shows in the standard logs
    logger.info(`[EventBus] 📥 New Subscriber for: ${eventType} (Total: ${this.handlers[eventType].length})`);
  }

  /**
   * Publish an event to all subscribers with 🛡️ Deduplication Guard.
   */
  async publish(event) {
    const { type, metadata } = event;
    const outboxId = metadata?.outboxId;

    // 🛡️ [PHASE 4] Distributed Deduplication
    if (outboxId) {
      const redis = require('../lib/redis');
      const dedupKey = `event_bus_dedup:${outboxId}`;
      
      // Atomic SET NX with 1 hour expiry
      const acquired = await redis.set(dedupKey, 'processed', 'NX', 'EX', 3600);
      if (!acquired) {
        logger.reasoning(`Skipping event ${outboxId} (${type}) because it was already processed by another worker (Distributed Deduplication).`, { outboxId });
        return;
      }
    }

    const handlers = this.handlers[type] || [];
    const globalHandlers = this.handlers['*'] || [];
    const allHandlers = [...handlers, ...globalHandlers];
    
    logger.debug(`[EventBus] 📤 Publishing ${type} to ${allHandlers.length} handlers`);

    const promises = allHandlers.map(async (handler, index) => {
      try {
        await handler(event);
      } catch (err) {
        logger.error(`[EventBus] ❌ Error in handler #${index} for ${type}:`, { error: err.message });
      }
    });

    await Promise.all(promises);
  }
  /**
   * 📬 Temporary Polyfill for Safe Redirect (Alias Layer)
   */
  async emitSafe(event, data = {}, ...args) {
    return await this.publish({ type: event, payload: data });
  }

  on(event, handler) {
    return this.subscribe(event, (evt) => handler(evt.payload));
  }

  /**
   * 👁️ Smart Global Event Tracing
   */
  onAny(handler) {
    this.subscribe('*', handler);
  }
}

const eventBusInstance = new EventBus();

// Global Logger (Smart Tracing)
// eventBusInstance.onAny((event) => {
//   console.log('[EVENT TRACE] ⚡', event.type);
// });

module.exports = eventBusInstance;
