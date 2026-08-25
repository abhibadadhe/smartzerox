/**
 * kit.fraud.js — Shared fraud utilities
 *
 * Re-exports the canonical implementations from kit.advanced-fraud-v2.js
 * so all modules import from one place, and adds dashboard helpers
 * (getSuspiciousOrders, getFraudStats) that the controller uses.
 */

'use strict';

const KitOrder  = require('./kit.model');
const logger    = require('../../config/logger');

// Re-export from V2 so any legacy import of kit.fraud still works
const {
  generateImageHash,
  checkScreenshotReuse,
  checkTransactionIdDuplicate,
  countRecentOrders,
  validateFileMetadata,
} = require('./kit.advanced-fraud-v2');

// Alias for backward compat (kit.advanced-fraud.js uses checkMultipleOrdersShortTime)
const checkMultipleOrdersShortTime = (userId, email, phone, window = 30) =>
  countRecentOrders(userId, email, phone, window).then(n => n > 1);

// Alias for backward compat (performFraudCheck was the old basic check)
const validateImageMetadata = validateFileMetadata;

// ─── Suspicious orders for shopkeeper dashboard ────────────────────────────
async function getSuspiciousOrders(page = 1, limit = 20) {
  const skip = (Number(page) - 1) * Number(limit);
  const [orders, total] = await Promise.all([
    KitOrder.find({ orderStatus: 'Suspicious' })
      .sort({ 'fraudFlags.flaggedAt': -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),  // Fix #13: removed -screenshotS3Key exclusion — controller needs it for presigned URLs
    KitOrder.countDocuments({ orderStatus: 'Suspicious' }),
  ]);
  return {
    orders,
    pagination: {
      total,
      page:  Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)),
    },
  };
}

// ─── Fraud statistics for dashboard ───────────────────────────────────────
async function getFraudStats() {
  const stats = await KitOrder.aggregate([{
    $facet: {
      totalOrders:         [{ $count: 'count' }],
      suspiciousOrders:    [{ $match: { orderStatus: 'Suspicious' } }, { $count: 'count' }],
      screenshotReuse:     [{ $match: { 'fraudFlags.screenshotReused': true } }, { $count: 'count' }],
      transactionDuplicate:[{ $match: { 'fraudFlags.transactionIdDuplicate': true } }, { $count: 'count' }],
      txnIdMismatch:       [{ $match: { 'fraudFlags.txnIdMismatch': true } }, { $count: 'count' }],
      amountMismatch:      [{ $match: { 'fraudFlags.amountMismatch': true } }, { $count: 'count' }],
      editedImages:        [{ $match: { 'fraudFlags.editedImage': true } }, { $count: 'count' }],
      multipleOrders:      [{ $match: { 'fraudFlags.multipleOrdersShortTime': true } }, { $count: 'count' }],
      averageFraudScore: [
        { $match: { 'fraudFlags.fraudScore': { $gt: 0 } } },
        { $group: { _id: null, avg: { $avg: '$fraudFlags.fraudScore' } } },
      ],
    },
  }]);

  const s = stats[0];
  return {
    totalOrders:          s.totalOrders[0]?.count          || 0,
    suspiciousOrders:     s.suspiciousOrders[0]?.count     || 0,
    screenshotReuse:      s.screenshotReuse[0]?.count      || 0,
    transactionDuplicate: s.transactionDuplicate[0]?.count || 0,
    txnIdMismatch:        s.txnIdMismatch[0]?.count        || 0,
    amountMismatch:       s.amountMismatch[0]?.count       || 0,
    editedImages:         s.editedImages[0]?.count         || 0,
    multipleOrders:       s.multipleOrders[0]?.count       || 0,
    averageFraudScore:    s.averageFraudScore[0]?.avg       || 0,
  };
}

module.exports = {
  // Core utilities (re-exported from V2)
  generateImageHash,
  checkScreenshotReuse,
  checkTransactionIdDuplicate,
  checkMultipleOrdersShortTime,
  validateImageMetadata,
  validateFileMetadata,
  // Dashboard helpers
  getSuspiciousOrders,
  getFraudStats,
};
