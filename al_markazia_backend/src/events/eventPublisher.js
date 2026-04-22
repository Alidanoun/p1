const prisma = require('../lib/prisma');
const eventBus = require('./eventBus');
const logger = require('../utils/logger');

/**
 * 📣 Event Publisher
 * Persists events to the Event Store (DB) and publishes them to the Bus.
 * This is the SINGLE gateway for creating system events.
 */
async function publishEvent({
  type,
  aggregateId,
  payload,
  version,
  metadata = {},
  tenantId = 'default-restaurant'
}) {
  try {
    // 1. Persist to DB (Source of Truth)
    const event = await prisma.event.create({
      data: {
        type,
        aggregateId: parseInt(aggregateId),
        aggregateType: 'order',
        payload: payload || {},
        metadata: metadata || {},
        version: version || 1,
        tenantId: tenantId || 'default-restaurant'
      },
    });

    // 2. Publish to memory bus (for real-time handlers)
    // We don't await this to keep the main flow fast, but we log errors inside handlers
    eventBus.publish(event).catch(err => {
      logger.error(`[EventPublisher] Bus publication failed for ${type}`, { error: err.message });
    });

    return event;
  } catch (err) {
    logger.error(`[EventPublisher] Failed to persist event ${type}`, { error: err.message, aggregateId });
    // Note: In strict Event Sourcing, if the event store fails, the whole operation should fail.
    // However, for this gradual migration, we might just log it unless it's critical.
    throw err; 
  }
}

module.exports = { publishEvent };
