const logger = require('../utils/logger');
const prisma = require('../lib/prisma');
const redis = require('../lib/redis');
const socketInit = require('../socket');

/**
 * 🛠️ Recovery Service
 * Contains intelligent hooks to attempt auto-healing of services
 * without requiring a full process restart.
 */
class RecoveryService {
  /**
   * Attempt to re-establish Prisma connection
   */
  async recoverDatabase() {
    logger.info('[Recovery] Attempting DB Recovery Hook...');
    try {
      await prisma.$connect();
      // Test the connection
      await prisma.$queryRaw`SELECT 1`;
      logger.info('[Recovery] Database connection restored successfully ✅');
      return true;
    } catch (err) {
      logger.error('[Recovery] DB Recovery failed ❌', { error: err.message });
      return false;
    }
  }

  /**
   * Refresh Socket.io server engine if it hangs
   */
  async recoverSocket() {
    logger.info('[Recovery] Attempting Socket.io heartbeat refresh...');
    try {
      const io = socketInit.getIO();
      // Force an engine check/refresh
      const clients = await io.fetchSockets();
      logger.info(`[Recovery] Socket engine healthy. Active sessions: ${clients.length}`);
      return true;
    } catch (err) {
       // If socket.io is completely dead, we can't easily "init" it again without the httpServer
       // so we just log failure for manual intervention or PM2 restart.
       logger.error('[Recovery] Socket engine recovery unreachable ❌', { error: err.message });
       return false;
    }
  }

  /**
   * Handle Service Down Signal with Persistent Backoff
   */
  async handleServiceFailure(serviceName) {
    const redisKey = `recovery:${serviceName}:state`;
    
    // 1. Get current state from Redis
    let state = { count: 0, lastAttempt: 0, cooldown: false };
    try {
      const cached = await redis.get(redisKey);
      if (cached) state = JSON.parse(cached);
    } catch (err) {}

    const now = Date.now();
    
    // 2. Cooldown Guard (Stop aggressive recovery)
    if (state.count >= 3) {
      const timeSinceLast = now - state.lastAttempt;
      if (timeSinceLast < 300000) { // 5 minutes global stop after 3 fails
        logger.warn(`[Recovery] 🛑 Service ${serviceName} is in hard cooldown. Skipping aggressive recovery.`);
        return false;
      }
      // Reset after long cooldown
      state.count = 0;
    }

    // 3. Backoff Intervals: 1s, 5s, 15s
    const intervals = [0, 1000, 5000, 15000];
    const waitTime = intervals[state.count] || 15000;
    
    if (now - state.lastAttempt < waitTime) {
      return false; // Not time yet
    }

    // 4. Update state and attempt
    state.count++;
    state.lastAttempt = now;
    await redis.set(redisKey, JSON.stringify(state), 'EX', 3600);

    let success = false;
    if (serviceName === 'db') success = await this.recoverDatabase();
    else if (serviceName === 'socket') success = await this.recoverSocket();

    if (success) {
      await redis.del(redisKey); // Reset on success
    }

    return success;
  }
}

module.exports = new RecoveryService();
