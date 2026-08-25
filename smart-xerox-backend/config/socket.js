const { Server } = require('socket.io');
const jwt    = require('jsonwebtoken');
const User   = require('../models/User');
const Shop   = require('../models/Shop');
const logger = require('./logger');

let io;

// ── In-memory shop cache: userId → { shopId, shopName, cachedAt } ─────────────
// Avoids a DB hit on every socket connection for shopkeepers.
// TTL: 5 minutes — stale enough to be fast, fresh enough to be correct.
const shopCache = new Map();
const SHOP_CACHE_TTL = 5 * 60 * 1000;

// ── Rate limiting Maps (module scope for cleanup interval) ──────────────────
// These are referenced in the cleanup interval, so they must be at module scope
const eventRateLimits = new Map(); // userId:eventName → [timestamps]
const requestFingerprints = new Map(); // fingerprint → [timestamps]
const FINGERPRINT_WINDOW = 60000; // 1 minute
const MAX_IDENTICAL_REQUESTS = 15; // Increased from 5 to allow heartbeats from multiple agents

async function getShopForUser(userId) {
  const cached = shopCache.get(userId);
  if (cached && (Date.now() - cached.cachedAt) < SHOP_CACHE_TTL) {
    return { _id: cached.shopId, name: cached.shopName };
  }
  const shop = await Shop.findOne({ owner: userId }).select('_id name').lean();
  if (shop) {
    shopCache.set(userId, { shopId: shop._id.toString(), shopName: shop.name, cachedAt: Date.now() });
  }
  return shop;
}

// Evict cache entry when shop is updated (call this from shop controller on update)
function evictShopCache(userId) {
  shopCache.delete(userId?.toString());
}

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? (origin, cb) => {
            const allowed = [process.env.FRONTEND_URL].filter(Boolean);
            if (!origin) return cb(null, true);
            if (allowed.includes(origin)) return cb(null, true);
            cb(new Error('Not allowed by CORS'));
          }
        : true,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout:           60000,
    pingInterval:          25000,
    maxHttpBufferSize:     1e5,    // 100KB max message — prevents memory bombs
    connectTimeout:        10000,  // fail fast if handshake hangs
    // Limit concurrent connections per user via middleware (see below)
  });

  // ── Redis Adapter for Multi-Instance Deployments ──────────────────────────
  // If REDIS_URL is set, use Redis adapter for Socket.IO
  // This allows Socket.IO to work across multiple server instances
  if (process.env.REDIS_URL) {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
      const { createClient } = require('redis');
      
      const pubClient = createClient({ url: process.env.REDIS_URL });
      const subClient = pubClient.duplicate();
      
      Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
        io.adapter(createAdapter(pubClient, subClient));
        logger.info('✅ Socket.IO Redis adapter initialized for multi-instance deployment');
      }).catch(err => {
        logger.warn(`⚠️ Failed to initialize Socket.IO Redis adapter: ${err.message}`);
        logger.warn('Socket.IO will use in-memory adapter (single instance only)');
      });
    } catch (err) {
      logger.warn(`⚠️ Socket.IO Redis adapter not available: ${err.message}`);
    }
  }

  // ── Periodic cleanup of in-memory rate-limit Maps (prevents memory leak) ──
  // Without this, requestFingerprints and eventRateLimits grow unbounded
  // on long-running servers and can consume 100+ MB after a few days.
  setInterval(() => {
    const now = Date.now();
    let fpCleaned = 0;
    let rlCleaned = 0;

    for (const [key, timestamps] of requestFingerprints.entries()) {
      if (timestamps.every(t => now - t > FINGERPRINT_WINDOW)) {
        requestFingerprints.delete(key);
        fpCleaned++;
      }
    }
    for (const [key, timestamps] of eventRateLimits.entries()) {
      if (timestamps.every(t => now - t > 60000)) {
        eventRateLimits.delete(key);
        rlCleaned++;
      }
    }
    if (fpCleaned > 0 || rlCleaned > 0) {
      logger.info(`Socket map cleanup: removed ${fpCleaned} fingerprints, ${rlCleaned} rate-limit entries`);
    }
  }, 60 * 1000); // every 1 minute

  // ── Auth middleware ────────────────────────────────────────────────────────
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      socket.userId   = decoded.id;
      socket.userRole = decoded.role;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // ── Per-user connection limit middleware ───────────────────────────────────
  // Prevents one user from opening 50 tabs and hammering the server
  io.use((socket, next) => {
    const MAX_SOCKETS_PER_USER = 5;
    const userId = socket.userId;
    if (!userId) return next();

    const room = io.sockets.adapter.rooms.get(`user:${userId}`);
    const currentCount = room ? room.size : 0;
    if (currentCount >= MAX_SOCKETS_PER_USER) {
      logger.warn(`Socket limit reached for user ${userId} (${currentCount} connections)`);
      return next(new Error('Too many connections'));
    }
    next();
  });

  // ── Rate limiting for socket events ────────────────────────────────────────
  // Prevents DOS attacks via socket event spam
  // eventRateLimits is now at module scope (see above)
  const MAX_EVENTS_PER_MINUTE = {
    'print:trigger': 5,
    'print:resume': 5,
    'order:accept': 10,
    'order:reject': 10,
  };

  io.use((socket, next) => {
    const originalEmit = socket.emit;
    socket.emit = function(eventName, ...args) {
      const limit = MAX_EVENTS_PER_MINUTE[eventName];
      if (limit) {
        const key = `${socket.userId}:${eventName}`;
        const now = Date.now();
        const timestamps = eventRateLimits.get(key) || [];
        const recentEvents = timestamps.filter(t => now - t < 60000);

        if (recentEvents.length >= limit) {
          logger.warn(`Rate limit exceeded for ${socket.userId} on ${eventName}`);
          return; // silently drop
        }

        recentEvents.push(now);
        eventRateLimits.set(key, recentEvents);
      }
      return originalEmit.apply(this, [eventName, ...args]);
    };
    next();
  });

  // ── Connection handler ─────────────────────────────────────────────────────
  io.on('connection', async (socket) => {
    logger.info(`Socket connected: ${socket.id} | User: ${socket.userId} | Role: ${socket.userRole}`);

    // Everyone joins their personal room
    socket.join(`user:${socket.userId}`);

    // Shopkeeper joins their shop room — uses cache to avoid DB hit per connection
    if (socket.userRole === 'shopkeeper') {
      try {
        const shop = await getShopForUser(socket.userId);
        if (shop) {
          socket.join(`shop:${shop._id}`);
          socket.shopId = shop._id.toString();
          logger.info(`Shopkeeper ${socket.userId} joined shop:${shop._id} (${shop.name})`);

        }
      } catch (err) {
        logger.warn(`Could not auto-join shop room: ${err.message}`);
      }
    }

    // Admin room
    if (socket.userRole === 'admin') {
      socket.join('admin:room');
    }

    // ── Shop manual join (fallback) ───────────────────────────────────────
    socket.on('join:shop', async (shopId) => {
      if (!shopId) {
        logger.warn('join:shop called without shopId');
        return;
      }
      if (socket.userRole === 'shopkeeper') {
        const shop = await getShopForUser(socket.userId);
        if (!shop || shop._id.toString() !== shopId.toString()) {
          logger.warn(`Socket ${socket.id} denied join:shop ${shopId}`);
          return;
        }
      } else if (socket.userRole !== 'admin') {
        return;
      }
      const shopRoom = `shop:${shopId}`;
      socket.join(shopRoom);
      
      const roomSockets = io.sockets.adapter.rooms.get(shopRoom);
      const memberCount = roomSockets ? roomSockets.size : 0;
      
      logger.info(`Socket ${socket.id} joined ${shopRoom} (now ${memberCount} members)`);
      
      // Send confirmation back to client
      socket.emit('shop:joined', { shopId, room: shopRoom, members: memberCount });

    });

    // ── User join order room ──────────────────────────────────────────────
    socket.on('join-order', async (orderId) => {
      if (!orderId) return;
      try {
        const Order = require('../models/Order');
        const order = await Order.findById(orderId).populate('shop');
        if (!order) return;

        const isOwner = order.user.toString() === socket.userId;
        let allowed = isOwner || socket.userRole === 'admin';
        if (!allowed && socket.userRole === 'shopkeeper') {
          const shop = await getShopForUser(socket.userId);
          allowed = shop && order.shop._id?.toString() === shop._id.toString();
        }
        if (!allowed) {
          logger.warn(`Socket ${socket.id} denied join-order ${orderId}`);
          return;
        }

        socket.join(`order:${orderId}`);
        logger.info(`Socket ${socket.id} joined order room: order:${orderId}`);
      } catch (err) {
        logger.warn(`join-order failed: ${err.message}`);
      }
    });


    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected: ${socket.id} | Reason: ${reason}`);
    });

    socket.on('error', (err) => {
      logger.error(`Socket error ${socket.id}: ${err.message}`);
    });

  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
};

// ── Event emitter helpers ──────────────────────────────────────────────────────

// To a specific user (browser tab)
const emitToUser = (userId, event, data) => {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
};

// To shopkeeper dashboard
const emitToShop = (shopId, event, data) => {
  if (!io) return;
  io.to(`shop:${shopId}`).emit(event, data);
};


// To admin panel
const emitToAdmin = (event, data) => {
  if (!io) return;
  io.to('admin:room').emit(event, data);
};

// Broadcast to all connected users and shopkeepers globally
const emitGlobalAnnouncement = (event, data) => {
  if (!io) return;
  io.emit(event, data);
};

module.exports = { initSocket, getIO, emitToUser, emitToShop, emitToAdmin, emitGlobalAnnouncement, evictShopCache };