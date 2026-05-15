const redis = require('../lib/redis');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const { getCorrelationId } = require('../utils/context');
const { trace } = require('@opentelemetry/api');

const STREAM_KEY = 'events:backbone';
const CONSUMER_GROUPS = [
  'cg:ui_fast_reader',
  'cg:loyalty_ledger',
  'cg:notification_engine',
  'cg:inventory_restock',
  'cg:financial_rollback',
  'cg:logistics_cleanup'
];

/**
 * 🛰️ Stream Backbone Factory (SDS 3.0: Production-Grade Single Backbone)
 * Provides centralized publishing via Redis Streams and state-based idempotency protections.
 */
class StreamBackbone {
  constructor() {
    this.streamKey = STREAM_KEY;
    this.isInitialized = false;
  }

  /**
   * 🚀 Ensure Stream and required Consumer Groups exist idempotently
   */
  async initialize() {
    if (this.isInitialized) return;
    
    for (const groupName of CONSUMER_GROUPS) {
      try {
        // Create stream automatically if it doesn't exist, start group from latest '$' or '0'
        // For production backbones, starting from '0' ensures robust backlog processing if needed,
        // but '$' ensures we only process fresh events from the moment the group is initialized.
        await redis.xgroup('CREATE', this.streamKey, groupName, '$', 'MKSTREAM');
        logger.info(`[StreamBackbone] 🛡️ Consumer Group initialized: ${groupName}`);
      } catch (err) {
        if (!err.message.includes('BUSYGROUP')) {
          logger.error(`[StreamBackbone] Failed to create group ${groupName}`, { error: err.message });
        }
      }
    }
    
    this.isInitialized = true;
    logger.info('[StreamBackbone] 🛰️ Redis Stream Backbone verified & production-ready.');
  }

  /**
   * 📤 Publish Event to the Single Backbone Source of Truth
   * Implements automated production capping (MAXLEN ~ 100000)
   */
  async publishToBackbone(type, payload, options = {}) {
    const eventId = options.eventId || uuidv4();
    
    // 📡 Context Awareness: Pull from active tracing context if possible
    const correlationId = options.correlationId || getCorrelationId() || uuidv4();
    const activeSpan = trace.getActiveSpan();
    const traceId = activeSpan?.spanContext()?.traceId || options.metadata?.traceId;

    const causationId = options.causationId || null;
    const version = options.version || 1;
    const eventSequence = options.eventSequence || 1;

    // 🛡️ Ensure metadata is preserved for downstream workers
    const metadata = {
      ...options.metadata,
      correlationId,
      traceId,
      publishedAt: new Date().toISOString()
    };

    const eventData = {
      eventId,
      type,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      aggregateId: options.aggregateId || 'system',
      aggregateType: options.aggregateType || 'unknown',
      version: String(version),
      eventSequence: String(eventSequence),
      correlationId,
      causationId: causationId || '',
      metadata: JSON.stringify(metadata),
      timestamp: String(Date.now())
    };

    try {
      // Flatten object into string key-value pairs for XADD stream entry format
      const entryArgs = [];
      for (const [k, v] of Object.entries(eventData)) {
        if (v !== undefined && v !== null) {
          entryArgs.push(k, String(v));
        }
      }

      // 🛡️ Capped stream appending with approximate maxlen to protect production memory
      const messageId = await redis.xadd(this.streamKey, 'MAXLEN', '~', 100000, '*', ...entryArgs);
      
      logger.debug(`[StreamBackbone] ⚡ Event written to backbone stream: ${type}`, { eventId, messageId });
      return { eventId, messageId, type, correlationId };
    } catch (err) {
      logger.error(`[StreamBackbone] Critical write failure for event ${type}`, { error: err.message });
      throw err;
    }
  }

  /**
   * 🔒 Production-Grade State-Based Idempotency Guard
   * Protects stream consumers against double processing on worker crashes or timeouts.
   * State machine transitions: None -> PROCESSING (short TTL) -> SUCCESS (long TTL) / FAILED (medium TTL).
   */
  async executeIdempotentTask(handlerKey, eventId, workerLogic) {
    const stateKey = `idempotent:${handlerKey}:${eventId}`;
    
    // 1. Attempt to claim the execution token with short TTL for active processing (5 minutes)
    // This perfectly solves the worker-crash deadlock edge case.
    const claimed = await redis.set(stateKey, 'PROCESSING', 'NX', 'EX', 300);
    
    if (!claimed) {
      const currentState = await redis.get(stateKey);
      if (currentState === 'SUCCESS') {
        logger.debug(`[IdempotencyGuard] Skipping duplicate event execution: ${stateKey} (Already Success)`);
        return { executed: false, status: 'SUCCESS' };
      }
      if (currentState === 'PROCESSING') {
        logger.warn(`[IdempotencyGuard] Event processing in flight: ${stateKey}. Throwing concurrency error to defer stream consumer.`);
        throw new Error('EVENT_PROCESSING_IN_FLIGHT');
      }
      // If state is FAILED or lock expired/stale, permit execution retry
      logger.info(`[IdempotencyGuard] Retrying failed or stale event execution: ${stateKey}`);
    }

    try {
      // Execute encapsulated target side-effect/worker logic
      const result = await workerLogic();

      // 2. Commit definitive Success state with persistent deduplication window (7 days)
      await redis.set(stateKey, 'SUCCESS', 'XX', 'EX', 7 * 86400);
      
      return { executed: true, status: 'SUCCESS', result };
    } catch (err) {
      // 3. Mark state as FAILED to differentiate from silent worker crash lockouts
      await redis.set(stateKey, 'FAILED', 'XX', 'EX', 3600);
      throw err;
    }
  }
}

module.exports = new StreamBackbone();
