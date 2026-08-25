const redis = require('redis');
const logger = require('./logger');

let redisClient = null;

const initRedis = async () => {
  if (!process.env.REDIS_URL) {
    logger.warn('REDIS_URL not set - Redis features disabled (rate limiting, Socket.IO scaling)');
    return null;
  }

  try {
    redisClient = redis.createClient({
      url: process.env.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error('Redis reconnection failed after 10 attempts');
            return new Error('Redis max retries exceeded');
          }
          return retries * 100;
        },
      },
    });

    redisClient.on('error', (err) => logger.error('Redis error:', err));
    redisClient.on('connect', () => logger.info('✅ Redis connected'));
    redisClient.on('reconnecting', () => logger.warn('⚠️ Redis reconnecting...'));

    await redisClient.connect();
    return redisClient;
  } catch (err) {
    logger.error('Failed to connect to Redis:', err.message);
    return null;
  }
};

const getRedis = () => redisClient;

module.exports = { initRedis, getRedis };
