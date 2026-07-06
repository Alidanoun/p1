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
      
      // 🔒 Cache Invalidation for Customer 360 View
      try {
        const customerId = payload?.customerId || payload?.order?.customerId;
        const branchId = payload?.branchId || payload?.order?.branchId;
        if (customerId) {
          const salesActivityService = require('../../services/salesActivityService');
          await salesActivityService.invalidateCustomer360Cache(customerId, branchId);
        }
      } catch (err) {
        logger.error(`[UIFastReaderConsumer] Error invalidating Customer 360 cache`, { error: err.message });
      }
      
      logger.debug(`[UIFastReaderConsumer] Performed volatile real-time fan-out projection for event ${type}`);
      // StreamConsumerGroup class automatically calls XACK immediately to unblock PEL
    }
  }
);

module.exports = uiFastReaderConsumer;
