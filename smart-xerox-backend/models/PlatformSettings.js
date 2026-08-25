const mongoose = require('mongoose');

/**
 * Singleton document holding global platform configuration.
 * Only one document should ever exist (enforced by key = 'global').
 */
const platformSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true, immutable: true },

    // ── Commission ────────────────────────────────────────────────────────────
    // Global commission percentage the platform takes from every order.
    // Per-shop override: if Shop.platformMargin > 0 it takes priority.
    commissionPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    // ── Order Division (automatic printer shifting) ────────────────────────────
    orderDivision: {
      enabled: { 
        type: Boolean, 
        default: true,
        description: 'Enable automatic order division by color mode'
      },
      autoSplitMixedColorOrders: { 
        type: Boolean, 
        default: true,
        description: 'Automatically split orders with mixed color/B&W into sub-orders'
      },
    },

    // ── Printer Assignment Strategy ───────────────────────────────────────────
    printerAssignment: {
      strategy: { 
        type: String, 
        enum: ['strict_type_match', 'load_balanced', 'cost_optimized'],
        default: 'strict_type_match',
        description: 'How to assign printers to jobs'
      },
      allowColorPrinterForBW: { 
        type: Boolean, 
        default: false,
        description: 'Allow using color printers for B&W jobs (NOT RECOMMENDED - default: false)'
      },
      allowBWPrinterForColor: { 
        type: Boolean, 
        default: false,
        description: 'Allow using B&W printers for color jobs (not recommended)'
      },
    },
  },
  { timestamps: true }
);

/**
 * Helper: get-or-create the singleton settings document.
 */
platformSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne({ key: 'global' });
  if (!settings) {
    settings = await this.create({ key: 'global' });
  }
  return settings;
};

/**
 * Helper: get global commission rate (used by pricing calculator)
 */
platformSettingsSchema.statics.getGlobal = async function () {
  return await this.getSettings();
};

module.exports = mongoose.model('PlatformSettings', platformSettingsSchema);
