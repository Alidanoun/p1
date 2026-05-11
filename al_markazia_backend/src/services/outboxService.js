/**
 * 📮 Transactional Outbox Service
 */
class OutboxService {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
  }

  async enqueue(type, payload, tx, sequenceNumber = null) {
    if (!tx) throw new Error('OUTBOX_REQUIRES_TRANSACTION');
    
    const { getCorrelationId, getBranchId } = require('../utils/context');
    const metadata = {
      correlationId: getCorrelationId(),
      branchId: getBranchId(),
      sequenceNumber, // 🧷 [PHASE 5] Global Ordering Anchor
      timestamp: new Date().toISOString()
    };

    return await tx.outboxEvent.create({
      data: { type, payload, metadata, status: 'PENDING' }
    });
  }

  async processPending() {
    const eventBus = require('../events/eventBus');
    try {
      const pendingCount = await this.prisma.outboxEvent.count({ where: { status: 'PENDING' } });
      if (pendingCount > 500) {
        // Fallback for systemControlPlane as it might not be in container yet
        try {
          const controlPlane = require('./systemControlPlane');
          await controlPlane.raiseAlert('OUTBOX_JAM', { pendingCount });
        } catch (e) {
          this.logger.logError('OutboxService.raiseAlert', e, { pendingCount });
        }
      }

      const events = await this.prisma.outboxEvent.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: 20
      });

      for (const event of events) {
        try {
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'DISPATCHED', processedAt: new Date() }
          });
          await eventBus.publish({ 
            type: event.type, 
            payload: event.payload, 
            metadata: { ...event.metadata, outboxId: event.id } 
          });
        } catch (err) {
          const updatedEvent = await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'FAILED', error: err.message, retries: { increment: 1 } }
          });

          // 🛡️ [SEC-FIX] Automatic Rollback Logic: If event fails 3 times, trigger compensation
          if (updatedEvent.retries >= 3) {
            this.logger.reasoning(`Event ${event.id} (${event.type}) reached max retries. Triggering automatic compensation (Rollback).`, { eventId: event.id });
            await this.triggerRollback(updatedEvent);
          }
        }
      }
    } catch (err) {
      this.logger.error('[Outbox] Background dispatch failed', { error: err.message });
    }
  }

  async immediateDispatch(eventId) {
    const eventBus = require('../events/eventBus');
    try {
      // 🛡️ [PHASE 4] Atomicity: Check and mark as DISPATCHED in a small transaction
      const event = await this.prisma.$transaction(async (tx) => {
         const e = await tx.outboxEvent.findUnique({ where: { id: eventId } });
         if (!e || e.status !== 'PENDING') return null;

         return await tx.outboxEvent.update({
           where: { id: eventId },
           data: { status: 'DISPATCHED', processedAt: new Date() }
         });
      });

      if (!event) return;

      // 🚀 Publish with original metadata (Correlation ID preserved)
      await eventBus.publish({ 
        type: event.type, 
        payload: event.payload, 
        metadata: { ...event.metadata, outboxId: event.id, sync: true } 
      });
      
    } catch (err) {
      this.logger.warn(`[Outbox] Immediate dispatch failed for ${eventId}`, { error: err.message });
      // Record failure for background retry
      await this.prisma.outboxEvent.update({
        where: { id: eventId },
        data: { status: 'FAILED', error: `Immediate: ${err.message}` }
      }).catch(() => {});
    }
  }

  async retryFailed() {
    try {
      await this.prisma.outboxEvent.updateMany({
        where: { status: 'FAILED', retries: { lt: 3 } },
        data: { status: 'PENDING' }
      });
    } catch (err) {
      this.logger.error('[Outbox] Failed to retry events', { error: err.message });
    }
  }

  /**
   * 🔄 Trigger Compensating Transaction (Rollback)
   */
  async triggerRollback(event) {
    const eventBus = require('../events/eventBus');
    this.logger.warn(`[Outbox] 🚨 MAX_RETRIES reached. Triggering Rollback for event ${event.id}`, { type: event.type });

    try {
      await eventBus.publish({
        type: `${event.type}.ROLLBACK`,
        payload: event.payload,
        metadata: { originalEventId: event.id, reason: 'MAX_RETRIES_EXCEEDED' }
      });

      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'ROLLED_BACK' }
      });
    } catch (err) {
      this.logger.error(`[Outbox] Critical: Rollback publication failed for ${event.id}`, { error: err.message });
    }
  }
}

// --- 🛡️ Backward Compatibility ---
const getContainer = () => require('../lib/container');
const proxy = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'OutboxService') return OutboxService;
    const service = getContainer().outboxService;
    const val = service[prop];
    return typeof val === 'function' ? val.bind(service) : val;
  }
});

module.exports = proxy;
module.exports.OutboxService = OutboxService;
