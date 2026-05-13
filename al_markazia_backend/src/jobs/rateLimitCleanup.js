const cron = require('node-cron');
const logger = require('../utils/logger');
const redis = require('../lib/redis');

class RateLimitCleanupJob {
  constructor(deps = {}) {
    this.redis = deps.redis || redis;
    this.logger = deps.logger || logger;
    this.pattern = 'ratelimit:*';
  }

  async run() {
    const start = Date.now();
    let deletedCount = 0;

    try {
      if (!this.redis || typeof this.redis.scanIterator !== 'function') {
        return;
      }

      // Perform low-impact memory traversal over prefix keys using SCAN
      for await (const key of this.redis.scanIterator({ MATCH: this.pattern, COUNT: 200 })) {
        try {
          const ttl = await this.redis.ttl(key);

          // Flush expired keys or keys exhibiting infinite/aberrant lifespans (> 24 hours)
          if (ttl <= 0 || ttl > 86400) {
            await this.redis.del(key);
            deletedCount++;
          }
        } catch (innerErr) {}
      }

      if (this.logger && typeof this.logger.info === 'function') {
        this.logger.info('[RateLimitCleanup] Distributed map keys cleanup cycle concluded successfully', {
          deletedCount,
          durationMs: Date.now() - start
        });
      }
    } catch (err) {
      if (this.logger && typeof this.logger.error === 'function') {
        this.logger.error('[RateLimitCleanup] Cleanup worker lifecycle execution encountered cluster failure', { error: err.message });
      }
    }
  }
}

// Automatically bind cron execution interval (Every 6 hours) if not executing inside tests
if (process.env.NODE_ENV !== 'test') {
  cron.schedule('0 */6 * * *', () => new RateLimitCleanupJob().run());
}

module.exports = RateLimitCleanupJob;
