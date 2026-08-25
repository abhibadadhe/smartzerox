/**
 * Circuit Breakers for External Services
 *
 * Wraps Razorpay, AWS S3, and email calls with circuit breakers so that
 * a slow or failing external service doesn't cascade into the entire API.
 *
 * States:
 *   CLOSED  — normal operation, requests pass through
 *   OPEN    — service is failing; requests fail fast with 503 (no waiting)
 *   HALF-OPEN — after resetTimeout, one probe request is allowed through
 *               to test if the service has recovered
 *
 * Tuning (per service):
 *   timeout              — max ms to wait for a single call
 *   errorThresholdPct    — % of failures in the rolling window to trip the breaker
 *   resetTimeout         — ms to wait before trying again after tripping
 *   volumeThreshold      — minimum calls in the window before the % is evaluated
 *
 * Usage:
 *   const { withRazorpay, withS3, withEmail } = require('../utils/circuitBreaker');
 *
 *   // Wrap any async call:
 *   const result = await withRazorpay(() => razorpay.orders.create({ ... }));
 *   const data   = await withS3(() => s3Client.send(command));
 *   await withEmail(() => transporter.sendMail({ ... }));
 */

const CircuitBreaker = require('opossum');
const logger         = require('../config/logger');

// ── Shared breaker factory ────────────────────────────────────────────────────
function makeBreaker(name, options = {}) {
  const defaults = {
    timeout:                  8000,   // 8 s — fail fast if service hangs
    errorThresholdPercentage: 50,     // trip after 50% failures
    resetTimeout:             30000,  // try again after 30 s
    volumeThreshold:          5,      // need at least 5 calls before evaluating %
    rollingCountTimeout:      60000,  // 1-minute rolling window
    rollingCountBuckets:      6,      // 10-second buckets
  };

  const breaker = new CircuitBreaker(async (fn) => fn(), { ...defaults, ...options });

  breaker.on('open',     () => logger.warn(`⚡ Circuit OPEN  — ${name} is failing fast`));
  breaker.on('halfOpen', () => logger.info(`⚡ Circuit HALF-OPEN — probing ${name}`));
  breaker.on('close',    () => logger.info(`✅ Circuit CLOSED — ${name} recovered`));
  breaker.on('fallback', () => logger.warn(`⚡ Circuit fallback triggered for ${name}`));

  return breaker;
}

// ── Per-service breakers ──────────────────────────────────────────────────────

// Razorpay: payment creation, verification, refunds
const razorpayBreaker = makeBreaker('Razorpay', {
  timeout:                  10000,  // Razorpay can be slow in India — 10 s
  errorThresholdPercentage: 40,
  resetTimeout:             60000,  // wait 60 s before retrying Razorpay
});

// AWS S3: uploads, downloads, deletes
const s3Breaker = makeBreaker('AWS-S3', {
  timeout:                  15000,  // large file uploads need more time
  errorThresholdPercentage: 50,
  resetTimeout:             30000,
});

// Email (Nodemailer / SMTP): order notifications
const emailBreaker = makeBreaker('Email', {
  timeout:                  8000,
  errorThresholdPercentage: 60,     // emails are non-critical — higher threshold
  resetTimeout:             120000, // wait 2 min before retrying email
});

// ── Convenience wrappers ──────────────────────────────────────────────────────

/**
 * Wrap a Razorpay call with the circuit breaker.
 * Throws AppError(503) when the breaker is open.
 *
 * @param {Function} fn - async function that calls Razorpay
 */
const withRazorpay = async (fn) => {
  try {
    return await razorpayBreaker.fire(fn);
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes('breaker is open')) {
      const { AppError } = require('./helpers');
      throw new AppError('Payment service is temporarily unavailable. Please try again in a moment.', 503);
    }
    throw err;
  }
};

/**
 * Wrap an AWS S3 call with the circuit breaker.
 * Throws AppError(503) when the breaker is open.
 *
 * @param {Function} fn - async function that calls S3
 */
const withS3 = async (fn) => {
  try {
    return await s3Breaker.fire(fn);
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes('breaker is open')) {
      const { AppError } = require('./helpers');
      throw new AppError('File storage service is temporarily unavailable. Please try again in a moment.', 503);
    }
    throw err;
  }
};

/**
 * Wrap an email send call with the circuit breaker.
 * Email failures are non-critical — this wrapper NEVER throws.
 * It logs a warning and returns false if the breaker is open or the call fails.
 *
 * @param {Function} fn - async function that sends an email
 * @returns {Promise<boolean>} true if sent, false if skipped/failed
 */
const withEmail = async (fn) => {
  try {
    await emailBreaker.fire(fn);
    return true;
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes('breaker is open')) {
      logger.warn('Email circuit open — skipping email notification');
    } else {
      logger.warn(`Email send failed: ${err.message}`);
    }
    return false;
  }
};

// ── Health status (for /health endpoint) ─────────────────────────────────────
const getCircuitBreakerStatus = () => ({
  razorpay: razorpayBreaker.status.stats,
  s3:       s3Breaker.status.stats,
  email:    emailBreaker.status.stats,
});

module.exports = { withRazorpay, withS3, withEmail, getCircuitBreakerStatus };
