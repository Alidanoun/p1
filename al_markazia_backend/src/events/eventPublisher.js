const prisma = require('../lib/prisma');
const distributedBus = require('./distributedEventBus');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * 📣 Unified Event Publisher
 * The single source of truth for creating and distributing system events.
 * Supports Hybrid Flow: Outbox (Persistent) + Redis Pub/Sub (Real-time).
 */
async function publishEvent({
  type,
  aggregateId,
  payload,
  version = 1,
  eventSequence = 1,
  previousVersion = 0,
  metadata = {},
  isCritical = true,
  correlationId = null,
  causationId = null
}) {
  try {
    const eventId = uuidv4();
    const corrId = correlationId || metadata.correlationId || uuidv4();

    // 1. 🏗️ Level 2: Durable Persistence (Transactional Outbox)
    // We expect 'tx' to be provided if we are inside a transaction.
    const { tx, ...cleanMetadata } = metadata;
    const dbTx = tx || prisma; 
    const container = require('../lib/container');
    const outboxService = container.outboxService;
    
    let persistedEvent = null;
    if (isCritical) {
      persistedEvent = await outboxService.enqueue(dbTx, {
        type,
        aggregateId,
        aggregateType: cleanMetadata.aggregateType || 'unknown',
        payload,
        version,
        eventSequence,
        metadata: { ...cleanMetadata, correlationId: corrId, causationId }
      });
      
      // 💓 Pulse: Trigger immediate background processing AFTER transaction commit
      // In a real app, you might use a hook. Here we pulse immediately.
      // If we are NOT in a tx, we pulse now. If we ARE, the caller should pulse.
      if (!metadata.tx) {
        setImmediate(() => outboxService.pulse());
      }
    } else {
      // 🚀 Level 1: Fast Transport (Non-critical events only)
      await distributedBus.publish(type, payload, {
        version,
        eventSequence,
        previousVersion,
        correlationId: corrId,
        causationId: causationId || metadata.eventId || null,
        isCritical
      });
    }

    return persistedEvent || { id: eventId, type, payload, metadata: { correlationId: corrId } };
  } catch (err) {
    logger.error(`[EventPublisher] Failed to publish event ${type}`, { error: err.message });
    throw err; 
  }
}

module.exports = { publishEvent };
