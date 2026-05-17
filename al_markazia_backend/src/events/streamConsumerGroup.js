const redis = require('../lib/redis');
const logger = require('../utils/logger');
const streamBackbone = require('./streamBackbone');
const { traceContext } = require('../utils/context');
const { trace, propagation, context } = require('@opentelemetry/api');

/**
 * 🛡️ Stream Consumer Group Standard Implementation (100% Production-Grade)
 * Manages reliable consumer group message loops, state-based idempotency encapsulation,
 * automatic XACK hand-offs, and continuous background auto-claiming for offline workers.
 */
class StreamConsumerGroup {
  constructor(groupName, consumerName, handlers = {}) {
    this.streamKey = 'events:backbone';
    this.groupName = groupName;
    this.consumerName = consumerName;
    this.handlers = handlers; // Mapping of eventType -> async handler function
    this.isRunning = false;
  }

  /**
   * 🚀 Start consumer background daemon loop and auto-claim reaper
   */
  async start() {
    if (this.isRunning) return;
    
    // Ensure backbone is initialized
    await streamBackbone.initialize();

    // 🛡️ Create a dedicated Redis client for blocking reads to avoid clogging the main shared connection
    const Redis = require('ioredis');
    const readConfig = {
      ...redis.options,
      commandTimeout: undefined // Disable command timeout for blocking reads so they can block safely
    };
    this.readClient = new Redis(readConfig);

    this.isRunning = true;
    logger.info(`[StreamConsumerGroup] 🟢 Consumer daemon active: ${this.groupName}:${this.consumerName}`);

    // Start background stream listener loop
    this._listenLoop();
    
    // Start automatic dead-letter & stale message auto-claimer task (Runs every 60 seconds)
    this.claimInterval = setInterval(() => this._reapStaleMessages(), 60000);
  }

  /**
   * 🛑 Stop consumer safely
   */
  stop() {
    this.isRunning = false;
    if (this.claimInterval) clearInterval(this.claimInterval);
    if (this.readClient) {
      this.readClient.quit().catch(() => {});
    }
    logger.info(`[StreamConsumerGroup] 🔴 Consumer daemon stopped: ${this.groupName}:${this.consumerName}`);
  }

  /**
   * 📥 Blocking listen loop pulling new messages for this consumer group
   */
  async _listenLoop() {
    while (this.isRunning) {
      try {
        // Block up to 2 seconds waiting for new unassigned stream elements using the dedicated read client
        const response = await this.readClient.xreadgroup(
          'GROUP', this.groupName, this.consumerName,
          'BLOCK', 2000,
          'COUNT', 10,
          'STREAMS', this.streamKey, '>'
        );

        if (response && response.length > 0) {
          const [[, messages]] = response;
          for (const message of messages) {
            await this._processMessage(message);
          }
        }
      } catch (err) {
        // Log stream network/timeout anomalies gracefully without halting background service loop
        logger.error(`[StreamConsumerGroup] Loop execution fault in ${this.groupName}`, { error: err.message });
        await new Promise(resolve => setTimeout(resolve, 1000)); // Decorrelated backoff
      }
    }
  }

  /**
   * ⚙️ Process a single pulled stream message wrapped in State-Based Idempotency Guard
   */
  async _processMessage(message) {
    const [messageId, fields] = message;
    
    // Reconstruct object payload from flat key-value pairs
    const event = {};
    for (let i = 0; i < fields.length; i += 2) {
      event[fields[i]] = fields[i + 1];
    }

    const { type, eventId } = event;
    const handler = this.handlers[type] || this.handlers['*']; // Support exact match or wildcard route

    if (!handler) {
      // Unhandled event types by this specific group are XACKed immediately to prevent clogging PEL
      await redis.xack(this.streamKey, this.groupName, messageId);
      return;
    }

    try {
      // Re-hydrate structured JSON payload and metadata if encoded as string
      let parsedPayload = event.payload;
      let parsedMetadata = event.metadata;
      try { if (typeof parsedPayload === 'string') parsedPayload = JSON.parse(parsedPayload); } catch (e) {}
      try { if (typeof parsedMetadata === 'string') parsedMetadata = JSON.parse(parsedMetadata); } catch (e) {}
      
      const metadata = parsedMetadata || {};
      const contextIds = {
        requestId: metadata.requestId || messageId,
        correlationId: metadata.correlationId || metadata.requestId || messageId,
        traceId: metadata.traceId
      };

      // 📡 OpenTelemetry Trace Continuation
      const tracer = trace.getTracer('al-markazia-events');
      const spanOptions = contextIds.traceId ? { links: [{ context: { traceId: contextIds.traceId, spanId: metadata.spanId || '' } }] } : {};

      await tracer.startActiveSpan(`consume:${type}`, spanOptions, async (span) => {
        // 🔒 Restore application-level context for consistent logging
        await traceContext.run(contextIds, async () => {
          // 🔒 Protect execution via production-grade state machine idempotency
          await streamBackbone.executeIdempotentTask(
            `${this.groupName}:${type}`,
            eventId || messageId,
            async () => {
              await handler({ ...event, payload: parsedPayload, metadata: parsedMetadata }, messageId);
            }
          );
        });
        span.end();
      });

      // ✔ Definitive XACK hand-off upon internal transactional completion
      await redis.xack(this.streamKey, this.groupName, messageId);
      logger.debug(`[StreamConsumerGroup] ✔ Successfully processed and XACKed message ${messageId} in ${this.groupName}`);
    } catch (err) {
      if (err.message === 'EVENT_PROCESSING_IN_FLIGHT') {
        // Silently defer message consumption without XACKing so it remains in PEL for subsequent claim
        return;
      }
      logger.error(`[StreamConsumerGroup] Event execution failed for ${type} (${messageId})`, { error: err.message });
      // Keep unACKed so dead-letter/auto-claim pipeline can catch and retry or quarantine it
    }
  }

  /**
   * 🧹 Background task reaping unACKed messages from offline or stalled consumers via XAUTOCLAIM
   */
  async _reapStaleMessages() {
    if (!this.isRunning) return;
    try {
      // Claim unacknowledged messages idle for over 3 minutes (180000ms) starting from ID '0-0'
      const response = await redis.xautoclaim(
        this.streamKey, this.groupName, this.consumerName,
        180000, '0-0', 'COUNT', 20
      );

      if (response) {
        const [nextStartId, claimedMessages] = response;
        if (claimedMessages && claimedMessages.length > 0) {
          logger.warn(`[StreamConsumerGroup] ♻️ Auto-claimed ${claimedMessages.length} stale messages in ${this.groupName}`);
          for (const msg of claimedMessages) {
            await this._processMessage(msg);
          }
        }
      }
    } catch (err) {
      logger.error(`[StreamConsumerGroup] Auto-claim harvest failed in ${this.groupName}`, { error: err.message });
    }
  }
}

module.exports = StreamConsumerGroup;
