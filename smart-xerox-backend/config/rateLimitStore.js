/**
 * Optional Redis-backed store for express-rate-limit v7.
 * Uses lazy getRedis() so it works after initRedis() in startServer().
 */

const { getRedis } = require('./redis');

function createRateLimitStore(prefix = 'rl') {
  return {
    init: () => {},
    increment: async (key) => {
      const redis = getRedis();
      if (!redis?.isReady) {
        return { totalHits: 1, resetTime: new Date(Date.now() + 900000) };
      }
      const redisKey = `${prefix}:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.expire(redisKey, 900);
      const ttl = await redis.ttl(redisKey);
      const ttlMs = ttl > 0 ? ttl * 1000 : 900000;
      return { totalHits: count, resetTime: new Date(Date.now() + ttlMs) };
    },
    decrement: async (key) => {
      const redis = getRedis();
      if (redis?.isReady) await redis.decr(`${prefix}:${key}`);
    },
    resetKey: async (key) => {
      const redis = getRedis();
      if (redis?.isReady) await redis.del(`${prefix}:${key}`);
    },
  };
}

module.exports = { createRateLimitStore };
