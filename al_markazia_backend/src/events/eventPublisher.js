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
    // 🛡️ [DEDUPLICATION LAYER] Prevent replay of the same aggregate version
    if (aggregateId && version) {
      const redis = require('../lib/redis');
      const dedupKey = `event_dedup:${type}:${aggregateId}:${version}`;
      
      const cachedEvent = await redis.get(dedupKey);
      if (cachedEvent) {
        logger.warn(`[EventPublisher] 🛡️ Duplicate event detected: ${dedupKey}. Returning cached version.`);
        return JSON.parse(cachedEvent);
      }
    }

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

    // 2. Cache in Redis (TTL: 1 hour)
    if (aggregateId && version) {
      const redis = require('../lib/redis');
      const dedupKey = `event_dedup:${type}:${aggregateId}:${version}`;
      await redis.setex(dedupKey, 3600, JSON.stringify(event));
    }

    // 3. Publish to memory bus (for real-time handlers: Socket, FCM, etc.)
    try {
      await eventBus.publish(event);
    } catch (busErr) {
      logger.error(`[EventPublisher] Bus publication failed for ${type}`, { error: busErr.message });
    }

    return event;
  } catch (err) {
    logger.error(`[EventPublisher] Failed to persist event ${type}`, { error: err.message, aggregateId });
    throw err; 
  }
}

module.exports = { publishEvent };
