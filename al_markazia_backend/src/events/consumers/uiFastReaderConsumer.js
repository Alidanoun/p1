const StreamConsumerGroup = require('../streamConsumerGroup');
const localBus = require('../eventBus');
const logger = require('../../utils/logger');

/**
 * 🥉 Priority 3 Stream Consumer: UI Fast Reader
 * Lightweight, read-only volatile fan-out projection consumer dedicated to real-time socket synchronizations.
 * Operates instantly without waiting for transactional state side-effects.
 */
const uiFastReaderConsumer = new StreamConsumerGroup(
  'cg:ui_fast_reader',
  `reader-${process.env.INSTANCE_ID || 'node-1'}`,
  {
    '*': async (event) => {
      const { type, payload } = event;
      
      // Emit locally to decoupled event listeners (like socketHandler) to broadcast across attached socket connection pools
      localBus.emit(type, { type, payload, metadata: { source: 'stream_backbone_projection' } });
      
      logger.debug(`[UIFastReaderConsumer] Performed volatile real-time fan-out projection for event ${type}`);
      // StreamConsumerGroup class automatically calls XACK immediately to unblock PEL
    }
  }
);

module.exports = uiFastReaderConsumer;
