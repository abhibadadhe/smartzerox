/**
 * Idempotency Middleware — uses shared Redis client when REDIS_URL is set.
 */

const { getRedis } = require('../config/redis');
const logger = require('../config/logger');

const inMemoryCache = new Map();
const TTL_SECONDS = 86400;
const MAX_IN_MEMORY_ENTRIES = 5000;

function trimIdempotencyCache() {
  if (inMemoryCache.size <= MAX_IN_MEMORY_ENTRIES) return;
  const toRemove = inMemoryCache.size - MAX_IN_MEMORY_ENTRIES;
  const keys = inMemoryCache.keys();
  for (let i = 0; i < toRemove; i++) {
    const { value: k } = keys.next();
    if (k) inMemoryCache.delete(k);
  }
}

const idempotencyMiddleware = async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) return next();

  if (!/^[a-zA-Z0-9\-]{20,}$/.test(idempotencyKey)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid Idempotency-Key format. Must be at least 20 alphanumeric characters.',
    });
  }

  const cacheKey = `idempotency:${req.user?.id || req.ip}:${idempotencyKey}`;

  try {
    const redis = getRedis();
    let cachedResponse = null;

    if (redis?.isReady) {
      const data = await redis.get(cacheKey);
      cachedResponse = data ? JSON.parse(data) : null;
    } else {
      cachedResponse = inMemoryCache.get(cacheKey) || null;
    }

    if (cachedResponse) {
      logger.info(`Idempotent request detected: ${cacheKey}`);
      return res.status(cachedResponse.statusCode).json(cachedResponse.body);
    }

    const originalJson = res.json.bind(res);
    res.json = function (body) {
      const statusCode = res.statusCode;
      if (statusCode >= 200 && statusCode < 300) {
        const responseData = { statusCode, body };
        if (redis?.isReady) {
          redis.setEx(cacheKey, TTL_SECONDS, JSON.stringify(responseData)).catch((err) => {
            logger.warn(`Redis idempotency set failed: ${err.message}`);
          });
        } else {
          inMemoryCache.set(cacheKey, responseData);
          trimIdempotencyCache();
          setTimeout(() => inMemoryCache.delete(cacheKey), TTL_SECONDS * 1000);
        }
      }
      return originalJson(body);
    };

    next();
  } catch (err) {
    logger.error(`Idempotency middleware error: ${err.message}`);
    next();
  }
};

const generateIdempotencyKey = () =>
  `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

module.exports = { idempotencyMiddleware, generateIdempotencyKey, trimIdempotencyCache };
