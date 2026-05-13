const Redis = require('ioredis');
const logger = require('../utils/logger');

const baseConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null,
};

// 💎 DB 0: Primary Cache & Shared State
const cache = new Redis({ ...baseConfig, db: 0 });

// 📡 DB 1: Distributed Event Bus (Pub/Sub)
const publisher = new Redis({ ...baseConfig, db: 1 });
const subscriber = new Redis({ ...baseConfig, db: 1, enableReadyCheck: false });
const socketSubscriber = new Redis({ ...baseConfig, db: 1, enableReadyCheck: false });

const clients = [cache, publisher, subscriber, socketSubscriber];

clients.forEach((client, index) => {
  client.on('connect', () => {
    const labels = ['Cache', 'Publisher', 'Subscriber', 'SocketSubscriber'];
    logger.info(`Redis [${labels[index]}] connected successfully to DB ${client.options.db}`);
  });

  client.on('error', (err) => {
    logger.error(`Redis connection error`, { error: err.message });
  });
});

const createSubscriber = () => new Redis({ ...baseConfig, db: 1, enableReadyCheck: false });

/**
 * 🛰️ Hybrid Redis Export
 * Exports the Primary Cache client directly to preserve backward compatibility,
 * while attaching Publisher, Subscriber, and createSubscriber factory for Distributed State (SDS).
 */
cache.cache = cache;
cache.publisher = publisher;
cache.subscriber = subscriber;
cache.socketSubscriber = socketSubscriber;
cache.createSubscriber = createSubscriber;
cache.getRedis = () => cache;

module.exports = cache;
