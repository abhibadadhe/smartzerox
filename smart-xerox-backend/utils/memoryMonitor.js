/**
 * Memory Monitoring Utility
 * 
 * Tracks Node.js memory usage and triggers warnings/cleanup when approaching limits.
 * Critical for production bulk order processing to prevent OOM crashes.
 */

'use strict';

const logger = require('../config/logger');

// Memory thresholds (in MB)
const THRESHOLDS = {
  WARNING:  300,  // Warn at 300MB heap usage
  CRITICAL: 380,  // Critical at 380MB (out of 408MB max)
};

/**
 * Get current memory snapshot with calculated metrics
 * @returns {Object} Memory snapshot with usage stats
 */
function getMemorySnapshot() {
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);
  const externalMB = Math.round(memUsage.external / 1024 / 1024);
  const heapPct = Math.round((heapUsedMB / heapTotalMB) * 100);
  const uptimeSec = Math.round(process.uptime());
  const uptimeMin = Math.round(uptimeSec / 60);

  let level = 'normal';
  if (heapUsedMB >= THRESHOLDS.CRITICAL) {
    level = 'critical';
  } else if (heapUsedMB >= THRESHOLDS.WARNING) {
    level = 'warning';
  }

  return {
    heapUsedMB,
    heapTotalMB,
    rssMB,
    externalMB,
    heapPct,
    uptimeSec,
    uptimeMin,
    level,
  };
}

/**
 * Handle memory pressure - log warnings and trigger GC if needed
 * @returns {Object} Memory snapshot after handling
 */
function handleMemoryPressure() {
  const snap = getMemorySnapshot();

  if (snap.level === 'critical') {
    logger.error(
      `🚨 CRITICAL MEMORY: ${snap.heapUsedMB}MB/${snap.heapTotalMB}MB (${snap.heapPct}%) - ` +
      `RSS: ${snap.rssMB}MB, External: ${snap.externalMB}MB`
    );
    
    // Trigger GC if available (requires --expose-gc flag)
    if (global.gc) {
      const before = snap.heapUsedMB;
      global.gc();
      const after = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      const freed = before - after;
      logger.info(`🧹 Manual GC freed ${freed}MB (${before}MB → ${after}MB)`);
    } else {
      logger.warn('⚠️ Manual GC not available. Start with --expose-gc flag for better memory management.');
    }
  } else if (snap.level === 'warning') {
    logger.warn(
      `⚠️ MEMORY WARNING: ${snap.heapUsedMB}MB/${snap.heapTotalMB}MB (${snap.heapPct}%) - ` +
      `RSS: ${snap.rssMB}MB`
    );
  }

  return snap;
}

/**
 * Force garbage collection if available
 * Used after processing large bulk orders
 */
function forceGC() {
  if (global.gc) {
    const before = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    global.gc();
    const after = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const freed = before - after;
    logger.debug(`🧹 GC: ${before}MB → ${after}MB (freed ${freed}MB)`);
  }
}

module.exports = {
  getMemorySnapshot,
  handleMemoryPressure,
  forceGC,
};
