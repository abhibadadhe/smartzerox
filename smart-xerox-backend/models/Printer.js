const mongoose = require('mongoose');

const printerSchema = new mongoose.Schema(
  {
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    displayName: {
      type: String,
      // Custom display name (e.g., "HP Color", "Canon B&W")
      // If not set, falls back to 'name'
    },
    systemName: {
      type: String,
      required: true,
    },
    ipAddress: {
      type: String,
      required: false,
      description: 'Private VPN IP address for direct IPP printing'
    },
    supportedFormats: {
      type: [String],
      default: [],
      description: 'Auto-detected document-format-supported MIME types from IPP query'
    },
    preferredFormat: {
      type: String,
      default: '',
      description: 'Best document format to use (auto-detected or manually overridden)'
    },
    formatDetectedAt: {
      type: Date,
      description: 'Timestamp of last successful format detection'
    },
    printerModel: {
      type: String,
      default: '',
      description: 'Auto-detected printer-make-and-model from IPP query'
    },
    ippVersion: {
      type: String,
      enum: ['1.1', '2.0'],
      default: '1.1',
      description: 'Auto-detected IPP version (1.1 is universal baseline per RFC 2911)'
    },
    // ── Duplex / sides capability (auto-detected via Get-Printer-Attributes) ──
    supportsDuplex: {
      type: Boolean,
      default: null,   // null = not yet detected; true/false = known
      description: 'Whether the printer has a duplex unit (auto-detected)'
    },
    sidesSupported: {
      type: [String],
      default: [],
      description: 'IPP sides-supported values e.g. ["one-sided","two-sided-long-edge"]'
    },
    type: {
      type: String,
      enum: ['bw', 'color'],
      default: 'bw',
    },
    ppm: {
      type: Number,
      default: 30, // Default to 30 pages per minute if unknown
    },
    status: {
      type: String,
      enum: ['running', 'stopped', 'error', 'offline'],
      default: 'offline',
    },
    isEnabled: {
      type: Boolean,
      default: true,
    },
    currentLoad: {
      type: Number,
      default: 0, // Number of pages currently in the queue
    },
    jobsInQueue: {
      type: Number,
      default: 0,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    agentId: {
      type: String,
    },
    totalJobsProcessed: {
      type: Number,
      default: 0,
    },
    totalPagesProcessed: {
      type: Number,
      default: 0,
    },
    averageJobTime: {
      type: Number,
      default: 0, // seconds per job average
    },
    lastJobCompletedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

printerSchema.index({ shop: 1 });
printerSchema.index({ systemName: 1 });
printerSchema.index({ shop: 1, systemName: 1 }, { unique: true }); // compound — fast upsert/heartbeat lookups
printerSchema.index({ shop: 1, isEnabled: 1, status: 1 });         // load balancer query
printerSchema.index({ lastSeen: 1, status: 1 });                    // stale-offline cron

module.exports = mongoose.model('Printer', printerSchema);
