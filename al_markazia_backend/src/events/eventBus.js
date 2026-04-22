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
   * Publish an event to all subscribers.
   */
  async publish(event) {
    const handlers = this.handlers[event.type] || [];
    const globalHandlers = this.handlers['*'] || [];
    
    const allHandlers = [...handlers, ...globalHandlers];
    
    logger.debug(`[EventBus] 📤 Publishing ${event.type} to ${allHandlers.length} handlers`);

    if (allHandlers.length === 0) {
      logger.warn(`[EventBus] ⚠️ No subscribers found for event: ${event.type}`);
    }

    const promises = allHandlers.map(async (handler, index) => {
      try {
        await handler(event);
      } catch (err) {
        logger.error(`[EventBus] ❌ Error in handler #${index} for ${event.type}:`, { error: err.message });
      }
    });

    await Promise.all(promises);
  }
}

module.exports = new EventBus();
