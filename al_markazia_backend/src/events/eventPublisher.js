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

    // 2. Publish to memory bus (for real-time handlers: Socket, FCM, etc.)
    // 🛡️ MUST await to ensure Socket emissions complete before API response returns
    try {
      await eventBus.publish(event);
    } catch (busErr) {
      // Bus failure should NOT block the main flow — log and continue
      logger.error(`[EventPublisher] Bus publication failed for ${type}`, { error: busErr.message });
    }

    return event;
  } catch (err) {
    logger.error(`[EventPublisher] Failed to persist event ${type}`, { error: err.message, aggregateId });
    // Note: In strict Event Sourcing, if the event store fails, the whole operation should fail.
    // However, for this gradual migration, we might just log it unless it's critical.
    throw err; 
  }
}

module.exports = { publishEvent };
