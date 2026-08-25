const mongoose = require('mongoose');
const logger = require('./logger');
const dns = require('dns');

const connectDB = async () => {
  // Set fallback public DNS servers to guarantee MongoDB Atlas SRV resolution
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
  } catch (dnsErr) {
    logger.warn('⚠️ Custom DNS servers could not be set:', dnsErr.message);
  }

  // ✅ PRODUCTION FIX: Enhanced connection pool settings for high load
  const options = {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS:          45000,
    maxPoolSize:              100,  // Increased from 50 for better concurrency
    minPoolSize:              10,   // Keep more connections ready
    maxIdleTimeMS:            30000,
    heartbeatFrequencyMS:     10000,
    retryWrites:              true,
    w:                        'majority',
    readPreference:           'primaryPreferred',
    compressors:              ['zlib'],
    // ✅ NEW: Auto-index management
    autoIndex:                process.env.NODE_ENV !== 'production', // Disable in production for performance
    // ✅ NEW: Buffer commands configuration
    bufferCommands:           true, // Buffer queries while connecting instead of throwing 500
    // ✅ NEW: Connection monitoring
    monitorCommands:          process.env.NODE_ENV === 'development',
  };

  try {
    await mongoose.connect(process.env.MONGODB_URI, options);
    logger.info(`✅ MongoDB Connected (Pool: ${options.maxPoolSize} max, ${options.minPoolSize} min)`);
  } catch (err) {
    logger.error('❌ MongoDB initial connection failed:', err.message);
    // Retry connection after 5 seconds
    setTimeout(connectDB, 5000);
    return;
  }

  mongoose.connection.on('connected', () => {
    logger.info('📡 Mongoose connected to DB');
  });

  mongoose.connection.on('error', (err) => {
    logger.error('❌ Mongoose connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('⚠️  Mongoose disconnected. Reconnecting in 5s...');
    setTimeout(connectDB, 5000);
  });

  // ✅ PRODUCTION FIX: Monitor connection pool health
  if (process.env.NODE_ENV === 'production') {
    setInterval(() => {
      try {
        const db = mongoose.connection.getClient();
        const pool = db?.topology?.s?.pool;
        if (pool) {
          const total = pool.totalConnectionCount || 0;
          const available = pool.availableConnectionCount || 0;
          const pending = pool.pendingConnectionCount || 0;
          
          if (available < 5) {
            logger.warn(`⚠️  DB Pool Low: ${available}/${total} available (${pending} pending)`);
          }
          
          // Log every 2 minutes in production
          if (Date.now() % 120000 < 30000) {
            logger.debug(`DB Pool: ${total} total, ${available} available, ${pending} pending`);
          }
        }
      } catch (err) {
        // Silently fail if pool info unavailable
      }
    }, 30000); // Check every 30 seconds
  }
};

module.exports = { connectDB };
