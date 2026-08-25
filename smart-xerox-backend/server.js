// ============================================
// SMART XEROX PRINTING PLATFORM - SERVER
// ============================================

const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const xss = require('xss-clean');           // XSS protection
const hpp = require('hpp');                  // NEW — HTTP parameter pollution
const cookieParser = require('cookie-parser'); // NEW — read cookies
const { createRateLimitStore } = require('./config/rateLimitStore');
require('dotenv').config();

// ─── Sentry Error Tracking (Optional) ────────────────────────────────────────
let Sentry;
if (process.env.SENTRY_DSN) {
  Sentry = require('@sentry/node');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}

const { initSocket } = require('./config/socket');
const { connectDB } = require('./config/database');
const { initRedis, getRedis } = require('./config/redis');
const logger = require('./config/logger');
const errorHandler = require('./middleware/errorHandler');
const { startCronJobs, stopCronJobs } = require('./jobs/cronJobs');
const securityMiddleware = require('./middleware/security');
const { monitorRequest } = require('./utils/securityMonitor');

// Route Imports
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const shopRoutes = require('./routes/shop.routes');
const orderRoutes = require('./routes/order.routes');
const paymentRoutes = require('./routes/payment.routes');
const uploadRoutes = require('./routes/upload.routes');
const adminRoutes = require('./routes/admin.routes');
const notificationRoutes = require('./routes/notification.routes');
const kitRoutes = require('./modules/kit/kit.routes');
const printerRoutes = require('./routes/printer.routes');
const otpRoutes = require('./routes/otp.routes');
const accountRecoveryRoutes = require('./routes/accountRecovery.routes');
const errorRoutes = require('./routes/error.routes');

const app = express();
const server = http.createServer(app);

// Trust reverse proxy (Render, Railway, nginx) for correct req.ip
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ─── Sentry Request Handler (must be first) ────────────────────────────────────
if (Sentry) {
  app.use(Sentry.Handlers.requestHandler());
}

// ─── Socket.IO Init ──────────────────────────────────────────────────────────
const io = initSocket(server);
app.set('io', io);

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "https://checkout.razorpay.com"],
      frameSrc:       ["'self'", "https://api.razorpay.com"],
      connectSrc:     ["'self'", "https://api.razorpay.com"],
      imgSrc:         ["'self'", "data:", "https:"],
      styleSrc:       ["'self'", "'unsafe-inline'"],  // needed for inline styles
      fontSrc:        ["'self'", "data:"],
      objectSrc:      ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      reportUri:      '/api/security/csp-report',  // CSP violation reporting
    },
  },
  hsts: {
    maxAge: 31536000,       // 1 year
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permittedCrossDomainPolicies: false,
  dnsPrefetchControl: { allow: false },
}));

// Remove X-Powered-By (already done by helmet but explicit is better)
app.disable('x-powered-by');

// ─── HTTPS Enforcement (Production Only) ────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

app.use(mongoSanitize());   // Prevent MongoDB injection
app.use(xss());             // NEW — Prevent XSS attacks
app.use(hpp());             // NEW — Prevent HTTP parameter pollution
app.use(compression());
app.use(cookieParser());    // NEW — Parse cookies

// ─── Advanced Security Middleware ─────────────────────────────────────────────
app.use(monitorRequest);                              // Real-time threat monitoring
app.use(securityMiddleware.detectSuspiciousActivity); // Pattern-based threat detection
app.use(securityMiddleware.fingerprintRequest);       // Bot detection
app.use(securityMiddleware.isHoneypotIp);            // Block known bad actors
app.use(securityMiddleware.geoBlock);                // Geographic restrictions

// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [process.env.FRONTEND_URL].filter(Boolean)
  : [process.env.FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'].filter(Boolean);

const corsOptions = {
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-razorpay-signature', 'Idempotency-Key', 'x-csrf-token'],
  exposedHeaders: ['x-new-token', 'x-refresh-token'],
  maxAge: 3600,
};

app.use((req, res, next) => {
  const isAgentRoute      = req.path.startsWith('/api/agent');
  const isHealthRoute     = req.path === '/health' || req.path === '/';   // Render pings both
  const isAuthRoute       = req.path.startsWith('/api/auth');
  const isPaymentWebhook  = req.path.startsWith('/api/payments/webhook');
  const isFavicon         = req.path === '/favicon.ico';                  // Browser auto-request, no origin
  const isPrintAgentRequest = req.path.startsWith('/api/orders') || 
                              req.path.startsWith('/api/printers') ||
                              req.path.startsWith('/api/notifications') ||
                              req.path.startsWith('/api/shops');
  
  corsOptions.origin = (origin, callback) => {
    // Allow requests with no Origin header for:
    // health checks, agent routes, auth routes, webhooks, print-agent (Electron app), favicon
    if (!origin) {
      if (
        isHealthRoute     ||
        isAgentRoute      ||
        isAuthRoute       ||
        isPaymentWebhook  ||
        isPrintAgentRequest ||
        isFavicon         ||
        process.env.NODE_ENV !== 'production'
      ) {
        return callback(null, true);
      }
      // Log but return 403, NOT a thrown Error (avoids 500)
      logger.warn(`CORS blocked: null origin for ${req.method} ${req.path}`);
      return callback(null, false);   // false = blocked, no exception
    }

    // Whitelist check
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Development: allow all origins
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    // Production: reject unknown origins (return false, not an Error)
    logger.warn(`CORS blocked: ${origin} for ${req.method} ${req.path}`);
    callback(null, false);
  };

  cors(corsOptions)(req, res, next);
});

// ─── Request Timeout ──────────────────────────────────────────────────────────
// Prevents hung requests from holding connections indefinitely.
// Upload and webhook routes get a longer window; everything else gets 30s.
app.use((req, res, next) => {
  const isUpload  = req.path.startsWith('/api/upload');
  const isWebhook = req.path.startsWith('/api/payments/webhook');
  const timeoutMs = isUpload ? 120_000 : isWebhook ? 10_000 : 30_000;

  req.setTimeout(timeoutMs);
  res.setTimeout(timeoutMs, () => {
    if (!res.headersSent) {
      logger.warn(`Request timeout: ${req.method} ${req.originalUrl}`);
      res.status(503).json({ success: false, message: 'Request timed out. Please try again.' });
    }
  });
  next();
});

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const rlStore = process.env.REDIS_URL ? { store: createRateLimitStore('global') } : {};

// Global limiter — 500 req per 15 min per IP
const globalLimiter = rateLimit({
  ...rlStore,
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 500 : 10000,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
});

const authLimiter = rateLimit({
  ...(process.env.REDIS_URL ? { store: createRateLimitStore('auth') } : {}),
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many auth attempts, please try again later.' },
  skipSuccessfulRequests: true,
});

const otpLimiter = rateLimit({
  ...(process.env.REDIS_URL ? { store: createRateLimitStore('otp') } : {}),
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many OTP requests. Try again in 15 minutes.' },
});

const uploadLimiter = rateLimit({
  ...(process.env.REDIS_URL ? { store: createRateLimitStore('upload') } : {}),
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 50 : 10000,
  skip: () => process.env.NODE_ENV !== 'production',
  message: { success: false, message: 'Upload limit reached. Try again in an hour.' },
});

const orderLimiter = rateLimit({
  ...(process.env.REDIS_URL ? { store: createRateLimitStore('order') } : {}),
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 10000,
  skip: () => process.env.NODE_ENV !== 'production',
  message: { success: false, message: 'Too many orders placed. Try again in an hour.' },
});

app.use('/api', globalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/auth/send-otp', otpLimiter);
app.use('/api/auth/verify-otp', otpLimiter);
app.use('/api/upload', uploadLimiter);
app.post('/api/orders', orderLimiter);

// ─── Body Parsing ─────────────────────────────────────────────────────────────
// Razorpay webhook needs raw body — must be BEFORE express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '100kb' }));           // tight limit — prevents JSON DoS
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// ─── Logging ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) },
  }));
}

// ─── Health Check ─────────────────────────────────────────────────────────────
// Root path — responds to Render's uptime ping and browser curl checks
app.get('/', (_req, res) => res.status(200).json({ status: 'ok' }));

// Silence browser favicon requests — avoids CORS warn + 404 log noise
app.get('/favicon.ico', (_req, res) => res.status(204).end());

app.get('/health', (req, res) => {
  const { getMemorySnapshot } = require('./utils/memoryMonitor');
  const memSnap = getMemorySnapshot();
  const isProd = process.env.NODE_ENV === 'production';
  const internalKey = req.headers['x-health-secret'];
  const showDetail = !isProd || (process.env.HEALTH_CHECK_SECRET && internalKey === process.env.HEALTH_CHECK_SECRET);

  if (!showDetail) {
    return res.status(memSnap.level === 'critical' ? 503 : 200).json({
      success: memSnap.level !== 'critical',
      status: memSnap.level === 'critical' ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
    });
  }

  const { getCircuitBreakerStatus } = require('./utils/circuitBreaker');
  res.status(memSnap.level === 'critical' ? 503 : 200).json({
    success: true,
    message: 'Smart Xerox API is running',
    timestamp: new Date().toISOString(),
    uptime: `${memSnap.uptimeMin}m`,
    memory: memSnap,
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    redis: require('./config/redis').getRedis()?.isReady ? 'connected' : 'disabled',
    circuits: getCircuitBreakerStatus(),
  });
});

// ─── Honeypot Endpoints (Trap for Bots) ──────────────────────────────────────
app.get('/api/admin/users/export', securityMiddleware.honeypot);
app.get('/api/admin/database/dump', securityMiddleware.honeypot);
app.get('/.env', securityMiddleware.honeypot);
app.get('/config.json', securityMiddleware.honeypot);

// ─── Security Reporting Endpoint ──────────────────────────────────────────────
app.post('/api/security/csp-report', express.json({ type: 'application/csp-report' }), securityMiddleware.cspViolationReporter);

// ─── Request Timing Middleware (Performance Monitoring) ─────
// Logs slow requests to identify bottlenecks
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn(`⏱️ Slow request: ${req.method} ${req.path} took ${duration}ms (status: ${res.statusCode})`);
    }
  });
  next();
});

// ─── CSRF Token Validation (for state-changing requests) ───────────────────
// Skip CSRF validation for auth, health, webhooks, and GET requests
app.use((req, res, next) => {
  // Generate CSRF token for GET requests (safe methods)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  
  // Skip CSRF for auth routes, webhooks, and health checks
  if (req.path.startsWith('/api/auth') || 
      req.path.startsWith('/api/payments/webhook') || 
      req.path === '/health') {
    return next();
  }

  // Verify CSRF token for POST/PATCH/DELETE
  const tokenFromHeader = req.headers['x-csrf-token'];
  const tokenFromBody = req.body?.csrfToken;
  
  // If no CSRF token, skip (optional - can be enforced per route)
  if (!tokenFromHeader && !tokenFromBody) {
    logger.debug(`CSRF: No token for ${req.method} ${req.path}`);
    return next();
  }

  // ✅ FIX: Use dedicated CSRF secret (falls back to JWT_SECRET if not set)
  const csrfSecret = process.env.CSRF_SECRET || process.env.JWT_SECRET;
  if (!csrfSecret) {
    logger.error('CSRF validation failed: No CSRF_SECRET or JWT_SECRET configured');
    return next(new (require('./utils/helpers')).AppError('Server configuration error', 500));
  }

  const expectedToken = require('crypto')
    .createHmac('sha256', csrfSecret)
    .update(req.user?.id || req.ip)
    .digest('hex');

  const providedToken = tokenFromHeader || tokenFromBody;
  if (providedToken !== expectedToken) {
    logger.warn(`CSRF: Invalid token for ${req.user?.id || req.ip}`);
    // Return error through proper error handler
    return next(new (require('./utils/helpers')).AppError('Invalid CSRF token', 403));
  }

  next();
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', securityMiddleware.adminIpWhitelist, adminRoutes); // IP whitelist for admin
app.use('/api/notifications', notificationRoutes);
app.use('/api/printers', printerRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/account-recovery', accountRecoveryRoutes); // Account recovery routes
app.use('/api/errors', errorRoutes);
// ─── Kit Section (independent module) ────────────────────────────────────────
app.use('/api/kit', kitRoutes);
// Serve kit payment screenshots statically
app.use('/uploads/kit', express.static(require('path').join(__dirname, 'uploads/kit')));

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// ─── Sentry Error Handler (must be before global error handler) ────────────────
if (Sentry) {
  app.use(Sentry.Handlers.errorHandler());
}

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

// ── CRITICAL FIX #12: Validate critical environment variables on startup ──────
const requiredEnvVars = [
  'MONGODB_URI',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'FRONTEND_URL',
];

if (process.env.NODE_ENV === 'production') {
  requiredEnvVars.push('RAZORPAY_WEBHOOK_SECRET');
}

const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingEnvVars.length > 0) {
  logger.error(`❌ Missing critical environment variables: ${missingEnvVars.join(', ')}`);
  console.error(`
═══════════════════════════════════════════════════════════════
❌ STARTUP ERROR: Missing Environment Variables
═══════════════════════════════════════════════════════════════

Your application is missing these REQUIRED environment variables:
${missingEnvVars.map(v => `  • ${v}`).join('\n')}

CORS will use FRONTEND_URL: ${process.env.FRONTEND_URL || 'NOT SET (defaults to empty)'}

To fix this:
1. Check your .env.production file has all required variables
2. Or set them in your deployment platform (Render, Railway, Vercel, etc.)
3. Make sure FRONTEND_URL matches your actual frontend domain

Example:
  FRONTEND_URL=https://your-frontend-domain.com
  MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/db
  JWT_SECRET=<64+ character hex string>
  etc.

═══════════════════════════════════════════════════════════════
  `);
  process.exit(1);
}

const startServer = async () => {
  try {
    // Initialize Redis (optional - for multi-instance deployments)
    await initRedis();

    await connectDB();
    logger.info('✅ MongoDB Connected');

    server.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
    });

    startCronJobs();
    logger.info('⏰ Cron jobs started');

    // Check Ghostscript availability for PDF→PS/PCL conversion
    try {
      const { isGhostscriptAvailable } = require('./utils/ghostscript');
      const gs = isGhostscriptAvailable();
      if (gs.available) {
        logger.info(`🖨️ Ghostscript v${gs.version} available — PDF→PostScript/PCL conversion enabled`);
      } else {
        logger.warn('⚠️ Ghostscript not found — PDF→PostScript/PCL conversion disabled');
        logger.warn('   Install: apt-get install ghostscript (Linux) or choco install ghostscript (Windows)');
      }
    } catch (e) {
      logger.warn(`⚠️ Ghostscript check failed: ${e.message}`);
    }

    // ── Connection pool monitoring — warns before pool exhaustion ─────────────
    // Runs every 30 seconds; logs a warning when fewer than 5 connections remain.
    setInterval(() => {
      try {
        const client = mongoose.connection.getClient();
        // topology.s.pool is available in the MongoDB Node.js driver
        const pool = client?.topology?.s?.pool;
        if (pool) {
          const total     = pool.totalConnectionCount     ?? '?';
          const available = pool.availableConnectionCount ?? '?';
          logger.info(`DB Pool: ${total} total, ${available} available`);
          if (typeof available === 'number' && available < 5) {
            logger.warn(`⚠️ DB connection pool running low — only ${available} connections available`);
          }
        }
      } catch {
        // topology may not expose pool stats on all driver versions — silently skip
      }
    }, 30 * 1000);

    // ── Memory / health monitoring — warns before OOM ─────────────────────────
    const { handleMemoryPressure } = require('./utils/memoryMonitor');
    setInterval(() => {
      const snap = handleMemoryPressure();
      logger.info(`Health: uptime=${snap.uptimeMin}m heap=${snap.heapUsedMB}/${snap.heapTotalMB}MB (${snap.heapPct}%) rss=${snap.rssMB}MB`);
    }, 60 * 1000);

  } catch (error) {
    logger.error('❌ Server startup error:', error);
    process.exit(1);
  }
};

startServer();

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received — shutting down gracefully...`);

  // 1. Stop accepting new HTTP connections
  server.close(async () => {
    logger.info('HTTP server closed — no new connections accepted');

    // 2. Stop all cron jobs so they don't fire during drain
    try { stopCronJobs(); logger.info('Cron jobs stopped'); } catch {}

    // 3. Close MongoDB connection cleanly
    try {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed');
    } catch (err) {
      logger.error('Error closing MongoDB connection:', err.message);
    }

    logger.info('Graceful shutdown complete');
    process.exit(0);
  });

  // 4. Force-kill if in-flight requests don't drain within 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after 30s — some requests may have been dropped');
    process.exit(1);
  }, 30 * 1000).unref(); // .unref() so this timer doesn't keep the event loop alive
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Promise Rejection:', err);
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

module.exports = { app, server };
