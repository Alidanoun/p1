const Redis = require('ioredis');
const logger = require('../utils/logger');

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null, // Required for BullMQ
};

const redis = new Redis(redisConfig);

redis.on('connect', () => {
  logger.info('Redis connected successfully');
});

redis.on('error', (err) => {
  logger.error('Redis connection error', { error: err.message });
});

module.exports = redis;
