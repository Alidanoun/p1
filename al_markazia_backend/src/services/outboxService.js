const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const redis = require('../lib/redis');

/**
 * 📮 Outbox Service (SDS 2.0)
 * Implements Transactional Outbox with Wake-up Pulse pattern.
 */
class OutboxService {
  /**
   * 📥 Enqueue: Save event to DB (Must be used INSIDE a transaction)
   */
  async enqueue(tx, { type, aggregateId, aggregateType, payload, version, eventSequence, metadata = {} }) {
    return tx.outboxEvent.create({
      data: {
        type,
        aggregateId: String(aggregateId),
        aggregateType,
        payload: payload || {},
        version: version || 1,
        eventSequence: eventSequence || 1,
        metadata: metadata || {}
      }
    });
  }

  /**
   * 💓 Pulse: Wake up all instances to process their local outbox queue
   */
  async pulse() {
    try {
      await redis.publish('outbox:pulse', JSON.stringify({ timestamp: Date.now() }));
    } catch (err) {
      logger.error('[OutboxService] Pulse failed', { error: err.message });
    }
  }

  /**
   * 🚀 Dispatch: Fetch and publish pending events to Redis Bus
   * Uses a lock to prevent multiple workers from processing the same events.
   */
  async dispatchPending() {
    const lockKey = 'lock:outbox_dispatcher';
    const hasLock = await redis.set(lockKey, 'locked', 'EX', 5, 'NX');
    if (!hasLock) return;

    try {
      const pending = await prisma.outboxEvent.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: 50
      });

      if (pending.length === 0) return;

      const distributedBus = require('../events/distributedEventBus');
      
      for (const event of pending) {
        try {
          await distributedBus.publish(event.type, event.payload, {
            eventId: event.id,
            aggregateId: event.aggregateId,
            aggregateType: event.aggregateType,
            version: event.version,
            eventSequence: event.eventSequence,
            metadata: event.metadata
          });

          await prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'DISPATCHED', processedAt: new Date() }
          });
        } catch (err) {
          logger.error(`[OutboxService] Failed to dispatch event ${event.id}`, { error: err.message });
          await prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'FAILED', error: err.message, retries: { increment: 1 } }
          });
        }
      }
    } finally {
      await redis.del(lockKey);
    }
  }
  /**
   * ⚡ Immediate Dispatch: Manually trigger dispatch for a specific event
   * Used for latency-sensitive operations to bypass the pulse/poll delay.
   */
  async immediateDispatch(eventId) {
    try {
      const event = await prisma.outboxEvent.findUnique({ where: { id: eventId } });
      if (!event || event.status !== 'PENDING') return;

      const distributedBus = require('../events/distributedEventBus');
      await distributedBus.publish(event.type, event.payload, {
        eventId: event.id,
        aggregateId: event.aggregateId,
        aggregateType: event.aggregateType,
        version: event.version,
        eventSequence: event.eventSequence,
        metadata: event.metadata
      });

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'DISPATCHED', processedAt: new Date() }
      });
    } catch (err) {
      logger.error(`[OutboxService] Immediate dispatch failed for ${eventId}`, { error: err.message });
    }
  }
}

module.exports = { OutboxService };
