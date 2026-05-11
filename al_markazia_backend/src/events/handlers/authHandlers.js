const eventBus = require('../eventBus');
const eventTypes = require('../eventTypes');
const logger = require('../../utils/logger');

/**
 * 🛡️ Distributed Authorization Handlers (SDS 2.0)
 * Listens for global auth change signals and enforces local revocation.
 */

// 1. Listen for Global USER_AUTH_CHANGED (Broadcasted via Redis Backbone)
eventBus.subscribe('USER_AUTH_CHANGED', async (event) => {
  const { userId, permissionVersion, sessionEpoch, sequence } = event.payload;
  
  try {
    const io = require('../../socket').getIO();
    if (!io) return;

    // Find all sockets connected to this user on THIS instance
    const sockets = await io.fetchSockets();
    const userSockets = sockets.filter(s => s.user?.id === userId);

    if (userSockets.length === 0) return;

    logger.info(`[SDS 2.0] Authorization change detected for user ${userId}. Re-validating ${userSockets.length} local sockets.`);

    for (const socket of userSockets) {
      // 🛡️ [SEQUENCE-GUARD] Prevent Out-of-order Rollbacks
      if (socket.data.lastSyncSequence >= (sequence || 0)) {
        logger.debug(`[SDS 2.0] Skipping stale auth event for user ${userId}`);
        continue;
      }

      socket.data.lastSyncSequence = sequence || 0;

      // 🛑 Signal Client to re-handshake
      await socket.smartEmit('AUTH_REVALIDATE_REQUIRED', { 
        reason: 'PERMISSIONS_CHANGED',
        version: permissionVersion,
        epoch: sessionEpoch
      });

      // 🏛️ The Zombie Room Killer: Recalculate rooms NOW
      await socket.recalculateRooms();
    }
  } catch (err) {
    logger.error('[SDS 2.0] Auth change propagation failed', { error: err.message, userId });
  }
});

logger.info('🛡️ [SDS 2.0] Distributed Auth Fabric initialized');
