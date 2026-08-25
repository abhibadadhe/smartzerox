const mongoose = require('mongoose');

const kitOrderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name:   { type: String, required: true, trim: true },
    phone:  { type: String, required: true, trim: true },
    email:  { type: String, required: true, trim: true, lowercase: true },

    year:       { type: String, required: true, enum: ['1st', '2nd', '3rd', '4th'] },
    department: { type: String, default: null },
    selectedNotes: [{ id: String, title: String, price: Number }],

    orderType:   { type: String, enum: ['FIRST_YEAR_KIT', 'CUSTOM_NOTES'], required: true },
    totalAmount: { type: Number, required: true },

    // S3 key — never store full URL, generate presigned on demand
    screenshotS3Key: { type: String, default: '' },
    screenshotHash:  { type: String, default: '' }, // SHA256 hash for duplicate detection

    transactionId:       { type: String, default: '' },
    specialInstructions: { type: String, default: '' },

    // ── Archival Fields ───────────────────────────────────────────────────────
    dataArchived: { type: Boolean, default: false },
    archivedAt:   { type: Date, default: null },

    // ── Kit OTP (auto-incrementing from 1001, assigned on accept) ────────────
    kitOtp: { type: Number, default: null },

    // ── Status flow ────────────────────────────────────────────────────────────
    // Pending Verification → Payment Verified → Accepted → Completed
    //                     → Suspicious → (Approved / Rejected)
    //                     → Rejected
    paymentStatus: {
      type:    String,
      enum:    ['Pending', 'Verified', 'Failed', 'Suspicious'],
      default: 'Pending',
    },
    orderStatus: {
      type:    String,
      enum:    ['Pending Verification', 'Payment Verified', 'Accepted', 'Rejected', 'Completed', 'Suspicious'],
      default: 'Pending Verification',
    },

    // ── Fraud Detection Fields ─────────────────────────────────────────────────
    fraudFlags: {
      // Original checks (V1)
      screenshotReused:      { type: Boolean, default: false },
      transactionIdDuplicate: { type: Boolean, default: false },
      multipleOrdersShortTime: { type: Boolean, default: false },
      suspiciousImageMetadata: { type: Boolean, default: false },
      txnIdMismatch:         { type: Boolean, default: false },
      amountMismatch:        { type: Boolean, default: false },
      editedImage:           { type: Boolean, default: false },
      pixelTampering:        { type: Boolean, default: false },
      invalidTxnFormat:      { type: Boolean, default: false },
      oldScreenshot:         { type: Boolean, default: false },
      
      // New V2 checks
      phoneEmailChanged:     { type: Boolean, default: false },
      upiIdMismatch:         { type: Boolean, default: false },
      wrongCurrency:         { type: Boolean, default: false },
      multipleTransactions:  { type: Boolean, default: false },
      exifModified:          { type: Boolean, default: false },
      noBankLogo:            { type: Boolean, default: false },
      blurredAreas:          { type: Boolean, default: false },
      wrongTimeZone:         { type: Boolean, default: false },
      missingUpiElements:    { type: Boolean, default: false },
      amountWordsMismatch:   { type: Boolean, default: false },
      
      flaggedAt:             { type: Date, default: null },
      flagReason:            { type: String, default: '' },
      fraudScore:            { type: Number, default: 0, min: 0, max: 1000 },
      
      // Detailed analysis
      details:               { type: mongoose.Schema.Types.Mixed, default: {} },
    },

    statusHistory: [
      {
        status:    String,
        note:      String,
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at:        { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

kitOrderSchema.index({ orderStatus: 1, createdAt: -1 });
kitOrderSchema.index({ email: 1, createdAt: -1 });
kitOrderSchema.index({ userId: 1, createdAt: -1 });
kitOrderSchema.index({ phone: 1 });
kitOrderSchema.index({ screenshotHash: 1 }); // For duplicate screenshot detection
kitOrderSchema.index({ transactionId: 1 }); // For duplicate transaction ID detection
kitOrderSchema.index({ 'fraudFlags.screenshotReused': 1 }); // For fraud queries
kitOrderSchema.index({ transactionId: 1 });
kitOrderSchema.index({ 'fraudFlags.transactionIdDuplicate': 1 });

// ─── Static method to generate next Kit OTP (cycles 1 -> 1000, then rolls back to 1) ──
kitOrderSchema.statics.getNextKitOtp = async function () {
  // Find the most recently assigned kitOtp order
  const lastOrder = await this.findOne({ kitOtp: { $ne: null } })
    .sort({ updatedAt: -1, _id: -1 })
    .select('kitOtp')
    .lean();

  let lastOtp = lastOrder?.kitOtp || 0;
  // If last OTP reached 1000 or is invalid, roll back to 1. Otherwise increment.
  let candidate = (lastOtp >= 1000 || lastOtp < 1) ? 1 : lastOtp + 1;

  // Collision safety: increment (rolling back 1000 -> 1) if candidate is in use by an active/accepted order
  let attempts = 0;
  while (await this.exists({ kitOtp: candidate, orderStatus: { $nin: ['Completed', 'Rejected'] } }) && attempts < 1000) {
    candidate = candidate >= 1000 ? 1 : candidate + 1;
    attempts++;
  }

  return candidate;
};

const KitOrder = mongoose.model('KitOrder', kitOrderSchema);

// Clean up stale non-sparse indexes if present in MongoDB
KitOrder.cleanIndexes().catch(() => {});

module.exports = KitOrder;
