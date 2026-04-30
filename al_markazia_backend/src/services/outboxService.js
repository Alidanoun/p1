const prisma = require('../lib/prisma');
const eventBus = require('../events/eventBus');
const logger = require('../utils/logger');

/**
 * 📮 Transactional Outbox Service
 * Ensures reliable event delivery using the outbox pattern.
 * Uses Prisma Client for type-safe database operations.
 */
class OutboxService {
  /**
   * 📥 Enqueue an event within a transaction
   */
  async enqueue(type, payload, tx) {
    if (!tx) throw new Error('OUTBOX_REQUIRES_TRANSACTION');
    
    return await tx.outboxEvent.create({
      data: {
        type,
        payload: payload,
        status: 'PENDING'
      }
    });
  }

  /**
   * 📤 Process Pending Events
   */
  async processPending() {
    try {
      // 1. 🔍 Backlog Health Check
      const pendingCount = await prisma.outboxEvent.count({
        where: { status: 'PENDING' }
      });

      if (pendingCount > 500) {
        const controlPlane = require('./systemControlPlane');
        await controlPlane.raiseAlert('OUTBOX_JAM', { pendingCount });
      }

      // 2. Fetch Events
      const events = await prisma.outboxEvent.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: 20
      });

      for (const event of events) {
        try {
          // 3. Mark as DISPATCHED
          await prisma.outboxEvent.update({
            where: { id: event.id },
            data: { 
              status: 'DISPATCHED', 
              processedAt: new Date() 
            }
          });

          // 4. Publish to EventBus
          eventBus.publish({
            type: event.type,
            payload: event.payload,
            metadata: { outboxId: event.id }
          });

          logger.debug(`[Outbox] Event ${event.id} dispatched successfully.`);
        } catch (err) {
          logger.error(`[Outbox] Dispatch error for ${event.id}`, { error: err.message });
          await prisma.outboxEvent.update({
            where: { id: event.id },
            data: { 
              status: 'FAILED', 
              error: err.message, 
              retries: { increment: 1 } 
            }
          });
        }
      }
    } catch (err) {
      logger.error('[Outbox] Background dispatch failed', { error: err.message });
    }
  }

  /**
   * ⚡ Immediate Dispatch
   */
  async immediateDispatch(eventId) {
    try {
      const event = await prisma.outboxEvent.findUnique({
        where: { id: eventId }
      });

      if (!event || event.status !== 'PENDING') return;

      await prisma.outboxEvent.update({
        where: { id: eventId },
        data: { 
          status: 'DISPATCHED', 
          processedAt: new Date() 
        }
      });

      eventBus.publish({
        type: event.type,
        payload: event.payload,
        metadata: { outboxId: event.id, sync: true }
      });

      logger.debug(`[Outbox] Immediate dispatch successful for ${event.id}`);
    } catch (err) {
      logger.warn(`[Outbox] Immediate dispatch failed for ${eventId}`, { error: err.message });
    }
  }

  /**
   * ♻️ Retry Failed Events
   */
  async retryFailed() {
    try {
      await prisma.outboxEvent.updateMany({
        where: { 
          status: 'FAILED', 
          retries: { lt: 5 } 
        },
        data: { status: 'PENDING' }
      });
    } catch (err) {
      logger.error('[Outbox] Failed to retry events', { error: err.message });
    }
  }
}

module.exports = new OutboxService();
