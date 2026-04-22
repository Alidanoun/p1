const EventEmitter = require('events');

/**
 * Global Event Bus - Singleton Instance
 * Used for decoupled signaling across services (e.g. Health status changes).
 */
class EventBus extends EventEmitter {
  constructor() {
    super();
    this.sequence = 0;
  }

  /**
   * 📬 Resilient & Ordered Emission Wrapper
   * Ensures one failing listener doesn't crash the whole process,
   * adds a monotonic sequence number for ordering guarantee.
   */
  emitSafe(event, data = {}, ...args) {
    this.sequence++;
    const enrichedData = {
      ...data,
      metadata: {
        ...(data.metadata || {}),
        sequence: this.sequence,
        timestamp: Date.now()
      }
    };

    try {
      return super.emit(event, enrichedData, ...args);
    } catch (err) {
      console.error(`[EventBus] 🚨 Failed to emit event: ${event}`, { error: err.message });
      return false;
    }
  }
}

const eventBus = new EventBus();

// Max listeners hardening to avoid memory leak warnings on high-throughput
eventBus.setMaxListeners(20);

module.exports = eventBus;
