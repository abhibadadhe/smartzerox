/**
 * PendingUpload — tracks every S3 file uploaded via /api/upload
 * that has NOT yet been claimed by a created order.
 *
 * Lifecycle:
 *   1. File uploaded → PendingUpload document created (status: 'pending')
 *   2. Order created with this s3Key → PendingUpload marked 'claimed'
 *   3. Cron runs every 30 min → deletes S3 files for 'pending' docs
 *      older than ORPHAN_TTL_MINUTES (default 30 min) and removes the record
 *
 * The MongoDB TTL index on `expiresAt` auto-removes claimed records after
 * 24 hours so the collection stays small.
 */

const mongoose = require('mongoose');

const pendingUploadSchema = new mongoose.Schema(
  {
    s3Key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    s3Url: {
      type: String,
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    originalName: { type: String },
    fileSize:     { type: Number },
    mimeType:     { type: String },

    // 'pending'  — uploaded, not yet used in any order
    // 'claimed'  — attached to an order (safe to ignore in cleanup)
    status: {
      type: String,
      enum: ['pending', 'claimed'],
      default: 'pending',
      index: true,
    },

    // TTL field — MongoDB auto-removes the document after this date.
    // For 'pending' docs: set to uploadedAt + ORPHAN_TTL_MINUTES
    // For 'claimed' docs: set to claimedAt + 24h (just for auto-cleanup of the record)
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 }, // MongoDB TTL index — removes doc when expiresAt passes
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for orphan cleanup cron: status + expiresAt
// Prevents full collection scan on every 30-minute cron run
pendingUploadSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model('PendingUpload', pendingUploadSchema);
