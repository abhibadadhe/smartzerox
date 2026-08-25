const mongoose = require('mongoose');

/**
 * Platform-wide settings stored in MongoDB.
 * Only one document exists (singleton pattern via `key: 'global'`).
 */
const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },

    // Default commission % charged on every order.
    // Applied when a shop has no custom platformMargin set (platformMargin === 0).
    // Admin can override per-shop via setShopMargin.
    defaultCommissionRate: {
      type: Number,
      default: 10,
      min: 0,
      max: 100,
    },

    // Human-readable label shown in admin UI
    commissionLabel: {
      type: String,
      default: 'Platform Commission',
      maxlength: 100,
    },

    // Global System Announcement & Maintenance Broadcast
    maintenanceMode: {
      type: Boolean,
      default: false,
    },
    systemAnnouncement: {
      type: String,
      default: '',
      maxlength: 500,
    },
    announcementType: {
      type: String,
      enum: ['info', 'warning', 'maintenance', 'error'],
      default: 'maintenance',
    },
  },
  { timestamps: true }
);

// Static helper — always returns the single settings document (creates if missing)
settingsSchema.statics.getGlobal = async function () {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) {
    doc = await this.create({ key: 'global' });
  }
  return doc;
};

module.exports = mongoose.model('Settings', settingsSchema);
