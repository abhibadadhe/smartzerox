// ============================================
// ADVANCED SECURITY MIDDLEWARE
// ============================================

const crypto = require('crypto');
const { AppError } = require('../utils/helpers');
const logger = require('../config/logger');
const rateLimit = require('express-rate-limit');

// ─── Request Fingerprinting (Bot Detection) ────────────────────────────────
const requestFingerprints = new Map();
const FINGERPRINT_WINDOW = 60000; // 1 minute
const MAX_IDENTICAL_REQUESTS = 100; // Increased: Allow frequent polling from print agents (5-second interval = ~12 req/min)

exports.fingerprintRequest = (req, res, next) => {
  try {
    const fingerprint = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          acceptLanguage: req.headers['accept-language'],
          acceptEncoding: req.headers['accept-encoding'],
          path: req.path,
          method: req.method,
        })
      )
      .digest('hex');

    const now = Date.now();
    const existing = requestFingerprints.get(fingerprint) || [];
    
    // Clean old entries
    const recent = existing.filter(timestamp => now - timestamp < FINGERPRINT_WINDOW);
    
    if (recent.length >= MAX_IDENTICAL_REQUESTS) {
      logger.warn(`Potential bot detected: ${req.ip} - ${fingerprint}`);
      return next(new AppError('Too many identical requests. Please try again later.', 429));
    }
    
    recent.push(now);
    requestFingerprints.set(fingerprint, recent);
    
    // Cleanup old fingerprints periodically
    if (Math.random() < 0.01) {
      for (const [key, timestamps] of requestFingerprints.entries()) {
        if (timestamps.every(t => now - t > FINGERPRINT_WINDOW)) {
          requestFingerprints.delete(key);
        }
      }
    }
    
    next();
  } catch (err) {
    next(err);
  }
};

// ─── CSRF Protection ────────────────────────────────────────────────────────
const csrfTokens = new Map();
const CSRF_TOKEN_EXPIRY = 3600000; // 1 hour

exports.generateCsrfToken = (req, res, next) => {
  const token = crypto.randomBytes(32).toString('hex');
  const sessionId = req.user?.id || req.ip;
  
  csrfTokens.set(sessionId, {
    token,
    expiresAt: Date.now() + CSRF_TOKEN_EXPIRY,
  });
  
  res.cookie('csrf-token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: CSRF_TOKEN_EXPIRY,
  });
  
  next();
};

exports.verifyCsrfToken = (req, res, next) => {
  try {
    // Skip CSRF for GET, HEAD, OPTIONS
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }
    
    const sessionId = req.user?.id || req.ip;
    const tokenFromHeader = req.headers['x-csrf-token'];
    const tokenFromCookie = req.cookies['csrf-token'];
    
    const stored = csrfTokens.get(sessionId);
    
    if (!stored || stored.expiresAt < Date.now()) {
      return next(new AppError('CSRF token expired. Please refresh the page.', 403));
    }
    
    if (!tokenFromHeader || tokenFromHeader !== stored.token || tokenFromHeader !== tokenFromCookie) {
      logger.warn(`CSRF token mismatch for ${sessionId}`);
      return next(new AppError('Invalid CSRF token', 403));
    }
    
    next();
  } catch (err) {
    next(err);
  }
};

// ─── IP Whitelisting for Admin Routes ───────────────────────────────────────
const ADMIN_WHITELIST = (process.env.ADMIN_IP_WHITELIST || '').split(',').filter(Boolean);

exports.adminIpWhitelist = (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'development') {
      return next();
    }
    
    const clientIp = req.ip || req.connection.remoteAddress;
    
    if (ADMIN_WHITELIST.length > 0 && !ADMIN_WHITELIST.includes(clientIp)) {
      logger.warn(`Unauthorized admin access attempt from IP: ${clientIp}`);
      return next(new AppError('Access denied from this IP address', 403));
    }
    
    next();
  } catch (err) {
    next(err);
  }
};

// ─── Request Signing for Critical Operations ────────────────────────────────
exports.verifyRequestSignature = (req, res, next) => {
  try {
    const signature = req.headers['x-request-signature'];
    const timestamp = req.headers['x-request-timestamp'];
    
    if (!signature || !timestamp) {
      return next(new AppError('Missing request signature', 400));
    }
    
    // Prevent replay attacks - reject requests older than 5 minutes
    const requestTime = parseInt(timestamp);
    if (Date.now() - requestTime > 300000) {
      return next(new AppError('Request expired', 400));
    }
    
    const payload = JSON.stringify(req.body) + timestamp;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.REQUEST_SIGNING_SECRET || process.env.JWT_SECRET)
      .update(payload)
      .digest('hex');
    
    if (signature !== expectedSignature) {
      logger.warn(`Invalid request signature from ${req.ip}`);
      return next(new AppError('Invalid request signature', 403));
    }
    
    next();
  } catch (err) {
    next(err);
  }
};

// ─── Geo-Blocking ───────────────────────────────────────────────────────────
const BLOCKED_COUNTRIES = (process.env.BLOCKED_COUNTRIES || '').split(',').filter(Boolean);

exports.geoBlock = (req, res, next) => {
  try {
    const country = req.headers['cf-ipcountry'] || req.headers['x-country-code'];
    
    if (country && BLOCKED_COUNTRIES.includes(country)) {
      logger.warn(`Blocked request from country: ${country}, IP: ${req.ip}`);
      return next(new AppError('Service not available in your region', 403));
    }
    
    next();
  } catch (err) {
    next(err);
  }
};

// ─── Honeypot Endpoints (Trap for Bots) ────────────────────────────────────
const honeypotIps = new Set();

exports.honeypot = (req, res) => {
  const ip = req.ip;
  honeypotIps.add(ip);
  logger.warn(`Honeypot triggered by IP: ${ip}, User-Agent: ${req.headers['user-agent']}`);
  
  // Return fake data to waste bot's time
  res.status(200).json({
    success: true,
    data: {
      users: Array(100).fill(null).map((_, i) => ({
        id: crypto.randomBytes(12).toString('hex'),
        email: `user${i}@fake.com`,
        token: crypto.randomBytes(32).toString('hex'),
      })),
    },
  });
};

exports.isHoneypotIp = (req, res, next) => {
  try {
    if (honeypotIps.has(req.ip)) {
      logger.warn(`Blocked honeypot IP: ${req.ip}`);
      return next(new AppError('Access denied', 403));
    }
    next();
  } catch (err) {
    next(err);
  }
};

// ─── Advanced Rate Limiting with Sliding Window ─────────────────────────────
const requestCounts = new Map();

exports.slidingWindowRateLimit = (maxRequests, windowMs) => {
  return (req, res, next) => {
    try {
      const key = `${req.ip}-${req.path}`;
      const now = Date.now();
      
      const requests = requestCounts.get(key) || [];
      const recentRequests = requests.filter(timestamp => now - timestamp < windowMs);
      
      if (recentRequests.length >= maxRequests) {
        return next(new AppError('Rate limit exceeded. Please slow down.', 429));
      }
      
      recentRequests.push(now);
      requestCounts.set(key, recentRequests);
      
      next();
    } catch (err) {
      next(err);
    }
  };
};

// ─── Suspicious Activity Detection ──────────────────────────────────────────
const suspiciousPatterns = [
  /(\bor\b|\band\b).*=.*--/i,           // SQL injection
  /<script|javascript:|onerror=/i,       // XSS
  /\.\.\//,                              // Path traversal
  /__proto__|constructor|prototype/i,    // Prototype pollution
  /eval\(|exec\(|system\(/i,             // Code injection
];

exports.detectSuspiciousActivity = (req, res, next) => {
  try {
    const checkString = JSON.stringify({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(checkString)) {
        logger.error(`Suspicious activity detected from ${req.ip}: ${pattern}`);
        return next(new AppError('Suspicious activity detected', 400));
      }
    }
    
    next();
  } catch (err) {
    next(err);
  }
};

// ─── Account Lockout After Failed Login Attempts ────────────────────────────
const loginAttempts = new Map();
const LOCKOUT_DURATION = 900000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 5;

exports.trackLoginAttempt = (identifier, success) => {
  const attempts = loginAttempts.get(identifier) || { count: 0, lockedUntil: null };
  
  if (success) {
    loginAttempts.delete(identifier);
    return { locked: false };
  }
  
  attempts.count += 1;
  attempts.lastAttempt = Date.now();
  
  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    attempts.lockedUntil = Date.now() + LOCKOUT_DURATION;
    loginAttempts.set(identifier, attempts);
    logger.warn(`Account locked: ${identifier}`);
    return { locked: true, lockedUntil: attempts.lockedUntil };
  }
  
  loginAttempts.set(identifier, attempts);
  return { locked: false, attemptsLeft: MAX_LOGIN_ATTEMPTS - attempts.count };
};

exports.checkAccountLockout = (identifier) => {
  const attempts = loginAttempts.get(identifier);
  
  if (!attempts || !attempts.lockedUntil) {
    return { locked: false };
  }
  
  if (Date.now() < attempts.lockedUntil) {
    return { locked: true, lockedUntil: attempts.lockedUntil };
  }
  
  // Lockout expired
  loginAttempts.delete(identifier);
  return { locked: false };
};

// ─── Session Device Tracking ────────────────────────────────────────────────
exports.trackDeviceFingerprint = (req, res, next) => {
  const deviceFingerprint = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        userAgent: req.headers['user-agent'],
        acceptLanguage: req.headers['accept-language'],
        screenResolution: req.headers['x-screen-resolution'],
        timezone: req.headers['x-timezone'],
      })
    )
    .digest('hex');
  
  req.deviceFingerprint = deviceFingerprint;
  next();
};

// ─── Audit Logging for Critical Operations ──────────────────────────────────
exports.auditLog = (action) => {
  return (req, res, next) => {
    const auditData = {
      timestamp: new Date().toISOString(),
      action,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      path: req.path,
      method: req.method,
      body: sanitizeForLogging(req.body),
    };
    
    logger.info(`AUDIT: ${action}`, auditData);
    next();
  };
};

function sanitizeForLogging(obj) {
  const sensitive = ['password', 'token', 'secret', 'key', 'otp', 'cvv', 'pin'];
  const sanitized = { ...obj };
  
  for (const key in sanitized) {
    if (sensitive.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = '***REDACTED***';
    }
  }
  
  return sanitized;
}

// ─── Content Security Policy Violation Reporter ─────────────────────────────
exports.cspViolationReporter = (req, res) => {
  const violation = req.body;
  logger.warn('CSP Violation:', {
    documentUri: violation['document-uri'],
    violatedDirective: violation['violated-directive'],
    blockedUri: violation['blocked-uri'],
    sourceFile: violation['source-file'],
  });
  res.status(204).end();
};

module.exports = exports;
