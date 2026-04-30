const prisma = require('../lib/prisma');
const eventBus = require('../events/eventBus');
const logger = require('../utils/logger');

/**
 * 📮 Transactional Outbox Service (Raw SQL Implementation)
 * Features Auto-Table-Creation to handle schema drift without migrations.
 */
class OutboxService {
  constructor() {
    this.tableInitialized = false;
  }

  /**
   * 🏗️ Ensure table exists in DB
   */
  async _ensureTable() {
    if (this.tableInitialized) return;
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "OutboxEvent" (
          id UUID PRIMARY KEY,
          type TEXT NOT NULL,
          payload JSONB NOT NULL,
          status TEXT DEFAULT 'PENDING',
          error TEXT,
          retries INTEGER DEFAULT 0,
          "processedAt" TIMESTAMP,
          "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      this.tableInitialized = true;
      logger.info('[Outbox] ✅ Database table verified/created.');
    } catch (err) {
      // If UUID fails (some environments), fallback to TEXT
      try {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "OutboxEvent" (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            payload JSONB NOT NULL,
            status TEXT DEFAULT 'PENDING',
            error TEXT,
            retries INTEGER DEFAULT 0,
            "processedAt" TIMESTAMP,
            "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        this.tableInitialized = true;
      } catch (inner) {
        logger.error('[Outbox] ❌ Critical: Failed to ensure table exists', { error: inner.message });
      }
    }
  }

  /**
   * 📥 Enqueue an event (Raw SQL)
   */
  async enqueue(type, payload, tx) {
    if (!tx) throw new Error('OUTBOX_REQUIRES_TRANSACTION');
    
    // Ensure table exists (Fire and forget, it will succeed eventually)
    this._ensureTable();

    const id = require('uuid').v4();
    const payloadStr = JSON.stringify(payload);

    await tx.$executeRawUnsafe(
      'INSERT INTO "OutboxEvent" (id, type, payload, status, "createdAt") VALUES ($1, $2, $3, $4, $5)',
      id, type, payloadStr, 'PENDING', new Date()
    );

    return { id };
  }

  /**
   * 📤 Process Pending Events (Raw SQL)
   */
  async processPending() {
    try {
      await this._ensureTable();

      // 1. 🔍 Backlog Health Check (Raw)
      const countResult = await prisma.$queryRawUnsafe('SELECT COUNT(*) as "count" FROM "OutboxEvent" WHERE status = \'PENDING\'');
      const pendingCount = Number(countResult[0]?.count || 0);

      if (pendingCount > 500) {
        const controlPlane = require('./systemControlPlane');
        await controlPlane.raiseAlert('OUTBOX_JAM', { pendingCount });
      }

      // 2. Fetch Events (Raw)
      const events = await prisma.$queryRawUnsafe(
        'SELECT * FROM "OutboxEvent" WHERE status = \'PENDING\' ORDER BY "createdAt" ASC LIMIT 20'
      );

      for (const event of events) {
        try {
          // 3. Mark as DISPATCHED
          await prisma.$executeRawUnsafe(
            'UPDATE "OutboxEvent" SET status = \'DISPATCHED\', "processedAt" = $1 WHERE id = $2',
            new Date(), event.id
          );

          // 4. Publish to EventBus
          eventBus.publish({
            type: event.type,
            payload: typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload,
            metadata: { outboxId: event.id }
          });

          logger.debug(`[Outbox] Event ${event.id} dispatched successfully.`);
        } catch (err) {
          logger.error(`[Outbox] Dispatch error for ${event.id}`, { error: err.message });
          await prisma.$executeRawUnsafe(
            'UPDATE "OutboxEvent" SET status = \'FAILED\', error = $1, retries = retries + 1 WHERE id = $2',
            err.message, event.id
          );
        }
      }
    } catch (err) {
      if (!err.message.includes('relation "OutboxEvent" does not exist')) {
        logger.error('[Outbox] Background dispatch failed', { error: err.message });
      }
    }
  }

  /**
   * ⚡ Immediate Dispatch (Raw SQL)
   */
  async immediateDispatch(eventId) {
    try {
      const results = await prisma.$queryRawUnsafe('SELECT * FROM "OutboxEvent" WHERE id = $1 AND status = \'PENDING\'', eventId);
      const event = results[0];

      if (!event) return;

      await prisma.$executeRawUnsafe(
        'UPDATE "OutboxEvent" SET status = \'DISPATCHED\', "processedAt" = $1 WHERE id = $2',
        new Date(), event.id
      );

      eventBus.publish({
        type: event.type,
        payload: typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload,
        metadata: { outboxId: event.id, sync: true }
      });

      logger.debug(`[Outbox] Immediate dispatch successful for ${event.id}`);
    } catch (err) {
      logger.warn(`[Outbox] Immediate dispatch failed for ${eventId}`, { error: err.message });
    }
  }

  /**
   * ♻️ Retry Failed Events (Raw SQL)
   */
  async retryFailed() {
    try {
      await prisma.$executeRawUnsafe(
        'UPDATE "OutboxEvent" SET status = \'PENDING\' WHERE status = \'FAILED\' AND retries < 5'
      );
    } catch (err) {
      // Silence if table not yet ready
    }
  }
}

module.exports = new OutboxService();
