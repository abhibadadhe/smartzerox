const mongoose = require('mongoose');
const crypto = require('crypto');

const printingRangeSchema = new mongoose.Schema({
  rangeStart: { type: Number, required: true, min: 1 },
  rangeEnd: { type: Number, required: true, min: 1 },
  copies: { type: Number, default: 1, min: 1, max: 100 },
  // ✅ FIX EDGE CASE #2: Remove default for colorMode - force explicit selection
  colorMode: { type: String, enum: ['bw', 'color'], required: true },
  // ✅ FIX EDGE CASE #2: Remove default for sides - force explicit selection
  sides: { type: String, enum: ['single', 'double'], required: true },
  pagesPerSheet: { type: Number, enum: [1, 2, 4, 6, 9, 16], default: 1 },
}, { _id: false });

const documentSchema = new mongoose.Schema({
  originalName: { type: String, required: true },
  s3Key: { type: String, required: true },
  s3Url: { type: String, required: true },
  fileSize: Number,
  mimeType: String,
  detectedPages: { type: Number, default: 0, required: true },
  printingOptions: {
    paperSize: { type: String, enum: ['A4', 'A3', 'Letter'], default: 'A4' },
    orientation: { type: String, enum: ['portrait', 'landscape', 'auto'], default: 'auto' },
  },
  // ── NEW: PPT/Presentation-specific options ──────────────────────────────────
  presentationOptions: {
    isPresentationFile: { type: Boolean, default: false }, // Auto-detected for .ppt, .pptx, .odp
    printLayout: { 
      type: String, 
      enum: [
        'full_page_slides',      // Full Page Slides (1 per page)
        'notes_pages',           // Notes Pages (slide + notes)
        'outline',               // Outline (text only)
        'handouts_1',            // Handouts: 1 slide per page
        'handouts_2_horizontal', // Handouts: 2 slides horizontal
        'handouts_2_vertical',   // Handouts: 2 slides vertical
        'handouts_3',            // Handouts: 3 slides (with lines)
        'handouts_4_horizontal', // Handouts: 4 slides horizontal (2×2)
        'handouts_6_horizontal', // Handouts: 6 slides horizontal (2×3)
        'handouts_9_horizontal', // Handouts: 9 slides horizontal (3×3)
      ], 
      default: 'handouts_4_horizontal',
      description: 'PowerPoint print layout style'
    },
    slidesPerPage: { 
      type: Number, 
      enum: [1, 2, 3, 4, 6, 9], 
      default: 4,
      description: 'Number of slides per printed page (for handouts)'
    },
    includeNotes: { type: Boolean, default: false }, // Print with speaker notes
    frameSlides: { type: Boolean, default: true }, // Add border around each slide
    scaleToFitPaper: { type: Boolean, default: true }, // Scale slides to fit paper
    highQuality: { type: Boolean, default: true }, // High quality printing
    printHiddenSlides: { type: Boolean, default: false }, // Include hidden slides
    collate: { type: Boolean, default: true }, // Collate copies
    orientation: { 
      type: String, 
      enum: ['portrait', 'landscape', 'auto'], 
      default: 'landscape',
      description: 'Page orientation for handout printing (landscape recommended for handouts)'
    },
    autoLandscape: { type: Boolean, default: true }, // Auto-switch to landscape for handouts (deprecated - use orientation field)
  },
  // ── NEW: Custom Photo & Image-specific options ──────────────────────────────
  imageOptions: {
    isImageFile: { type: Boolean, default: false },
    printType: { 
      type: String, 
      enum: ['full_page', 'stamp_grid', 'custom_size'], 
      default: 'full_page' 
    },
    customWidthCm: { type: Number, default: 10 },
    customHeightCm: { type: Number, default: 7.5 },
    drawCutLines: { type: Boolean, default: true }
  },
  // Per-range printing configuration (supports different colors/copies for different page ranges)
  printingRanges: [printingRangeSchema],
  price: { type: Number, default: 0 },
  downloadedByShop: { type: Boolean, default: false },
  downloadedAt: Date,
}, { _id: true });

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      // Unique index with partial filter is created via fixOrderNumberIndexPartial.js
      // This allows multiple null values while enforcing uniqueness for assigned order numbers
      // See: backend/scripts/fixOrderNumberIndexPartial.js
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: true,
    },
    documents: [documentSchema],
    additionalServices: {
      spiralBinding: { type: Boolean, default: false },
      blackbook: { type: Boolean, default: false },
      lamination: { type: Boolean, default: false },
      urgentPrinting: { type: Boolean, default: false },
    },
    specialInstructions: { type: String, maxlength: 500 },
    pricing: {
      subtotal: { type: Number, required: true },
      platformMargin: { type: Number, default: 0 },
      commissionPercent: { type: Number, default: 0 }, // commission % applied at order time
      additionalServicesCharge: { type: Number, default: 0 },
      total: { type: Number, required: true },
      shopReceivable: { type: Number, required: true }, // total - commission
    },
    status: {
      type: String,
      enum: ['pending_payment', 'paid', 'queued', 'accepted', 'rejected', 'printing', 'ready', 'picked_up', 'expired', 'cancelled', 'refunded'],
      default: 'pending_payment',
    },
    statusHistory: [
      {
        status: String,
        timestamp: { type: Date, default: Date.now },
        note: String,
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
    payment: {
      razorpayOrderId: String,
      razorpayPaymentId: String,
      razorpaySignature: String,
      razorpayTransferId: String,
      platformCommission: { type: Number, default: 0 }, // Admin margin in paise
      shopPayout: { type: Number, default: 0 },         // Shopkeeper payout in paise
      status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
      paidAt: Date,
      method: String,
    },
    pickup: {
      qrCode: { type: String }, // base64 QR code image
      qrCodeData: { type: String }, // data embedded in QR
      pickupCode: { type: String }, // numeric code (1-1000)
      verifiedAt: Date,
      verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      // ── NEW: Track how pickup was verified ──────────────────────────────────
      verificationMethod: { 
        type: String, 
        enum: ['manual', 'qr_scan', 'auto_confirm', 'otp_entry'], 
        default: 'manual',
        description: 'manual=shopkeeper typed OTP, qr_scan=shopkeeper scanned QR, auto_confirm=student clicked email link, otp_entry=shopkeeper typed OTP'
      },
    },
    expiry: {
      expiresAt: { type: Date },
      extended: { type: Boolean, default: false },
      extendedAt: Date,
      extendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
    // ── Print Job Tracking (fault-tolerant printing) ─────────────────────────
    printJob: {
      status: {
        type: String,
        enum: ['idle', 'queued', 'printing', 'paused', 'completed', 'incomplete', 'failed'],
        default: 'idle',
      },
      startedAt:         Date,
      completedAt:       Date,
      pausedAt:          Date,
      pauseReason:       String,   // 'out_of_paper' | 'power_failure' | 'printer_error' | 'manual'
      totalPages:        { type: Number, default: 0 },
      printedPages:      { type: Number, default: 0 },  // checkpoint — pages done so far
      currentDocIndex:   { type: Number, default: 0 },  // which document we are on
      currentRangeIndex: { type: Number, default: 0 },  // which range within that doc
      currentCopyIndex:  { type: Number, default: 0 },  // which copy within that range
      retryCount:        { type: Number, default: 0 },
      lastError:         String,
      agentId:           String,   // socket id of the agent that is printing
      verificationFailed: { type: Boolean, default: false }, // true if verification failed
    },
    assignedPrinter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Printer',
    },
    assignedPrinterName:       { type: String }, // denormalized display name
    assignedPrinterSystemName: { type: String }, // OS-level printer name for pdf-to-printer
    rejectionReason: String,
    shopNote: String, // Note from shopkeeper to user
    rating: {
      score: { type: Number, min: 1, max: 5 },
      review: String,
      ratedAt: Date,
    },
    refund: {
      amount: Number,
      razorpayRefundId: String,
      reason: String,
      processedAt: Date,
    },
    // User dismissed this order from their My Orders view after 24h auto-hide
    hiddenFromUser: { type: Boolean, default: false },
    hiddenAt:       { type: Date },
    // Shop history auto-hidden after 24h (keeps dashboard clean in production)
    hiddenFromShop: { type: Boolean, default: false },
    hiddenFromShopAt: { type: Date },
    // Idempotency key — prevents duplicate orders from rapid double-submits
    idempotencyKey: { type: String, sparse: true },

    // ── NEW: Order Division (automatic printer shifting) ──────────────────────
    // Track if this order was divided into sub-orders by color mode
    isDivided: { 
      type: Boolean, 
      default: false,
      description: 'true if order was split into color/B&W sub-orders'
    },

    // Parent order reference (if this is a sub-order)
    parentOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      description: 'Reference to parent order if this is a sub-order'
    },

    // Child sub-orders (if this is a parent order)
    subOrders: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      description: 'References to color/B&W sub-orders'
    }],

    // Track which color mode this order is for (if sub-order)
    colorMode: {
      type: String,
      enum: ['bw', 'color', 'mixed'],
      default: 'mixed',
      description: 'Color mode for this order (mixed=not divided, bw/color=sub-order)'
    },

    // Multi-printer assignment (new)
    assignedPrinters: [{
      printer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Printer',
      },
      colorMode: { type: String, enum: ['bw', 'color'] },
      status: { type: String, enum: ['pending', 'printing', 'completed'], default: 'pending' },
      printedPages: { type: Number, default: 0 },
    }],

    // Track if all sub-orders are ready for pickup
    allSubOrdersReady: {
      type: Boolean,
      default: false,
      description: 'true when all sub-orders reach "ready" status'
    },

    // 1-Month Order Document Data Archival (clears files/heavy doc details while keeping all financial revenue data)
    dataArchived: {
      type: Boolean,
      default: false,
      index: true
    },
    archivedAt: {
      type: Date
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ shop: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
// ── CRITICAL FIX: Partial unique index for orderNumber ──────────────────────
// Allows multiple null values (orders pending payment) while enforcing
// uniqueness for assigned order numbers (after payment success)
orderSchema.index(
  { orderNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { orderNumber: { $type: 'string' } },
    name: 'uq_orderNumber_partial',
  }
);
orderSchema.index({ 'expiry.expiresAt': 1 });
orderSchema.index({ 'payment.razorpayOrderId': 1 });
orderSchema.index({ hiddenFromUser: 1, status: 1, updatedAt: 1 }); // for 24h auto-hide cron
orderSchema.index({ hiddenFromShop: 1, status: 1, updatedAt: 1 }); // for shop 24h auto-hide cron
// ── Production load indexes ────────────────────────────────────────────────────
orderSchema.index({ status: 1, 'expiry.expiresAt': 1 });           // expiry cron
orderSchema.index({ status: 1, updatedAt: -1 });                    // S3 cleanup cron
orderSchema.index({ shop: 1, status: 1, createdAt: -1 });          // shop dashboard queries
orderSchema.index({ user: 1, hiddenFromUser: 1, createdAt: -1 });  // user my-orders queries
// ── Missing indexes (added for production performance) ────────────────────────
orderSchema.index({ 'printJob.status': 1, 'printJob.verificationFailed': 1 }); // auto-retry cron
orderSchema.index({ shop: 1, status: 1, 'printJob.status': 1 });               // agent replay + stale order cron
orderSchema.index({ status: 1, 'printJob.status': 1, updatedAt: -1 });         // re-emit stale accepted cron
orderSchema.index({ assignedPrinter: 1, 'printJob.status': 1 });               // offline printer reassignment cron
orderSchema.index(
  { user: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
    name: 'uq_user_idempotency_key',
  }
);                                                                               // duplicate order prevention
// ── Order division indexes (automatic printer shifting) ──────────────────────
orderSchema.index({ parentOrder: 1 });                                         // find sub-orders
orderSchema.index({ isDivided: 1, status: 1 });                                // find divided orders
orderSchema.index({ colorMode: 1, shop: 1 });                                  // query by color mode
orderSchema.index({ shop: 1, status: 1 }, { name: 'idx_shop_incomplete_jobs' }); // OPTIMIZED: for incomplete jobs polling

// orderNumber is set to the sequential OTP (pickupCode) at order creation
// No temporary ID needed anymore

// Virtual: is expired
orderSchema.virtual('isExpired').get(function () {
  if (!this.expiry?.expiresAt) return false;
  return new Date() > this.expiry.expiresAt;
});

// Add status to history
orderSchema.methods.addStatusHistory = function (status, note, userId) {
  this.statusHistory.push({ status, note, updatedBy: userId, timestamp: new Date() });
  this.status = status;
};

// ✅ FIX #17: Sanitize specialInstructions to prevent XSS
// Even though xss-clean middleware is applied globally, explicit sanitization
// in the model provides defense-in-depth and ensures text-only rendering
orderSchema.pre('save', function (next) {
  if (this.specialInstructions) {
    // Remove any HTML tags and encode special characters
    // This ensures the field is always plain text, safe for display
    this.specialInstructions = this.specialInstructions
      .replace(/<[^>]*>/g, '')  // Remove HTML tags
      .replace(/&/g, '&amp;')   // Encode ampersand
      .replace(/</g, '&lt;')    // Encode less-than
      .replace(/>/g, '&gt;')    // Encode greater-than
      .replace(/"/g, '&quot;')  // Encode quotes
      .trim();
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
