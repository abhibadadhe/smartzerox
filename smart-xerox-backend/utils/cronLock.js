/**
 * Distributed Cron Lock — MongoDB-backed
 *
 * Prevents duplicate cron job execution when multiple server instances
 * are running (e.g. horizontal scaling on Render, Railway, etc.).
 *
 * How it works:
 *   - Each cron job calls acquireLock(name, ttlMs) before doing any work.
 *   - The lock is a document in the `cronlocks` collection.
 *   - findOneAndUpdate with upsert atomically sets the lock only if it has
 *     expired (expiresAt < now), so only ONE server wins per window.
 *   - The winning server runs the job; all others skip silently.
 *   - TTL is set to the cron interval + a small buffer so the lock always
 *     expires before the next run, even if the job crashes mid-way.
 *
 * Single-server deployments:
 *   - acquireLock always returns true (no contention) — zero overhead.
 *
 * Usage:
 *   const { acquireLock } = require('../utils/cronLock');
 *
 *   const cronJob = cron.schedule('* /15 * * * *', async () => {
 *     if (!(await acquireLock('expireOrders', 14 * 60 * 1000))) return;
 *     // ... do work
 *   });
 */

const mongoose = require('mongoose');
const logger   = require('../config/logger');

// ── Schema ────────────────────────────────────────────────────────────────────
const cronLockSchema = new mongoose.Schema(
  {
    _id:       { type: String },          // lock name is the _id
    expiresAt: { type: Date, required: true },
    lockedBy:  { type: String },          // hostname for debugging
  },
  { collection: 'cronlocks', versionKey: false }
);

// TTL index — MongoDB auto-removes expired lock documents.
// This is a safety net; the lock logic itself uses expiresAt comparisons.
cronLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Avoid model re-registration in hot-reload environments
const CronLock = mongoose.models.CronLock || mongoose.model('CronLock', cronLockSchema);

// Stable identifier for this process (hostname + pid)
const INSTANCE_ID = `${require('os').hostname()}-${process.pid}`;

/**
 * Try to acquire a named lock for `ttlMs` milliseconds.
 *
 * @param {string} name   - Unique lock name (e.g. 'expireOrders')
 * @param {number} ttlMs  - How long to hold the lock (milliseconds)
 * @returns {Promise<boolean>} true if lock acquired, false if another instance holds it
 */
const acquireLock = async (name, ttlMs) => {
  try {
    const now       = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    // Atomically acquire the lock only if it doesn't exist or has expired.
    // upsert: true creates the document if it doesn't exist.
    // The filter `expiresAt < now` ensures we only overwrite expired locks.
    const result = await CronLock.findOneAndUpdate(
      { _id: name, expiresAt: { $lt: now } },
      { $set: { expiresAt, lockedBy: INSTANCE_ID } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // If the returned document's lockedBy matches us, we won the lock.
    return result?.lockedBy === INSTANCE_ID;
  } catch (err) {
    // Duplicate key error (code 11000) means another instance won the race.
    if (err.code === 11000) return false;

    // On DB error, skip the job (fail closed) to avoid duplicate cron runs
    logger.warn(`cronLock.acquireLock('${name}') error: ${err.message} — skipping job`);
    return false;
  }
};

/**
 * Release a lock early (optional — locks expire automatically via TTL).
 * Useful if a job finishes well before the TTL to allow the next server
 * to pick up the next scheduled run immediately.
 *
 * @param {string} name - Lock name to release
 */
const releaseLock = async (name) => {
  try {
    await CronLock.findOneAndUpdate(
      { _id: name, lockedBy: INSTANCE_ID },
      { $set: { expiresAt: new Date(0) } } // expire immediately
    );
  } catch (err) {
    logger.warn(`cronLock.releaseLock('${name}') error: ${err.message}`);
  }
};

module.exports = { acquireLock, releaseLock };
