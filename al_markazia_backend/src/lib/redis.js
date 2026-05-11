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
const subscriber = new Redis({ ...baseConfig, db: 1 });

const clients = [cache, publisher, subscriber];

clients.forEach((client, index) => {
  client.on('connect', () => {
    const labels = ['Cache', 'Publisher', 'Subscriber'];
    logger.info(`Redis [${labels[index]}] connected successfully to DB ${client.options.db}`);
  });

  client.on('error', (err) => {
    logger.error(`Redis connection error`, { error: err.message });
  });
});

module.exports = {
  cache,
  publisher,
  subscriber,
  // Backward compatibility
  getRedis: () => cache 
};
