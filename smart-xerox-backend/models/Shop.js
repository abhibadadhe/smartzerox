const mongoose = require('mongoose');

const shopSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Shop name is required'],
      trim: true,
      maxlength: [100, 'Shop name cannot exceed 100 characters'],
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    phone: {
      type: String,
      required: [true, 'Shop phone is required'],
      match: [/^[6-9]\d{9}$/, 'Invalid phone number'],
    },
    email: { type: String, lowercase: true, trim: true },
    address: {
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
      landmark: String,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },
    pricing: {
      bw: {
        singleSided: { type: Number, required: true, default: 2 },
        doubleSided: { type: Number, required: true, default: 3 },
      },
      color: {
        singleSided: { type: Number, required: true, default: 10 },
        doubleSided: { type: Number, required: true, default: 15 },
      },
      bindingPerDocument: { type: Number, default: 20 },
      laminationPerPage: { type: Number, default: 10 },
    },
    platformMargin: {
      type: Number,
      default: 0, // Percentage added by admin
    },
    operatingHours: {
      monday: { open: String, close: String, closed: { type: Boolean, default: false } },
      tuesday: { open: String, close: String, closed: { type: Boolean, default: false } },
      wednesday: { open: String, close: String, closed: { type: Boolean, default: false } },
      thursday: { open: String, close: String, closed: { type: Boolean, default: false } },
      friday: { open: String, close: String, closed: { type: Boolean, default: false } },
      saturday: { open: String, close: String, closed: { type: Boolean, default: false } },
      sunday: { open: String, close: String, closed: { type: Boolean, default: true } },
    },
    services: {
      xerox: { type: Boolean, default: true },
      printing: { type: Boolean, default: true },
      scanning: { type: Boolean, default: false },
      binding: { type: Boolean, default: false },
      lamination: { type: Boolean, default: false },
      stationery: { type: Boolean, default: false },
    },
    images: [String],
    rating: { type: Number, default: 0, min: 0, max: 5 },
    totalRatings: { type: Number, default: 0 },
    totalOrders: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    availableBalance: { type: Number, default: 0 },
    withdrawnAmount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    isOpen: { type: Boolean, default: true },
    pendingOrdersCount: { type: Number, default: 0 },
    bankDetails: {
      accountNumber: { type: String, select: false },
      ifscCode: { type: String, select: false },
      accountHolderName: { type: String, select: false },
      bankName: String,
    },
    upiId: { type: String, select: false },
    // Direct Shopkeeper Razorpay Gateway Settings
    razorpayKeyId: { type: String, trim: true, default: null }, // Shop's own Razorpay Key ID (e.g. rzp_live_... or rzp_test_...)
    razorpayKeySecret: { type: String, trim: true, default: null, select: false }, // Shop's Key Secret (hidden by default)
    razorpayAccountId: { type: String, trim: true, default: null }, // Legacy Route account ID
    commissionPercentage: { type: Number, default: 5.0, min: 0, max: 100 }, // Platform margin %
    splitPaymentEnabled: { type: Boolean, default: false },
    // Manual Commission Tracking (Admin collects manually from Shopkeeper)
    commissionDue: { type: Number, default: 0, min: 0 }, // Uncollected platform commission owed to Admin
    commissionPaid: { type: Number, default: 0, min: 0 }, // Total commission settled to Admin
    commissionHistory: [
      {
        amount: { type: Number, required: true },
        date: { type: Date, default: Date.now },
        paymentMethod: { type: String, enum: ['upi', 'cash', 'bank_transfer'], default: 'upi' },
        referenceId: { type: String, default: null },
        notes: { type: String, default: null },
        collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
    notifications: {
      newOrder: { type: Boolean, default: true },
      orderExpiry: { type: Boolean, default: true },
    },
    // Sequential OTP counter — increments 1→1000 then resets to 1
    otpCounter: { type: Number, default: 0 },
    // Verification timeout in milliseconds (for large print jobs)
    // Default: 30000ms (30s) — can be increased for slow printers
    verificationTimeoutMs: { type: Number, default: 30000, min: 5000, max: 600000 },
    // OTP placement preference: which page(s) to stamp the OTP on
    // 'all_pages'   — stamp on every page (default)
    // 'first_page'  — stamp only on the first page
    // 'last_page'   — stamp only on the last page
    // 'extra_page'  — append a blank page at the end with the OTP printed on it
    otpPlacement: {
      type: String,
      enum: ['first_page', 'last_page', 'all_pages', 'extra_page'],
      default: 'all_pages',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Geospatial index for nearby shop search
shopSchema.index({ location: '2dsphere' });
shopSchema.index({ isActive: 1, isVerified: 1 });
shopSchema.index({ owner: 1 });

// Virtual: full address
shopSchema.virtual('fullAddress').get(function () {
  const a = this.address;
  return `${a.street}, ${a.city}, ${a.state} - ${a.pincode}`;
});

// Calculate effective price (commission is taken from shop earnings, NOT added to customer price)
shopSchema.methods.getEffectivePrice = function (type, side) {
  return this.pricing[type][side];
};

/**
 * Helper method to check if the shop is currently open:
 * Respects `this.isOpen` (the shopkeeper toggle switch).
 */
shopSchema.methods.isCurrentlyOpen = function () {
  return Boolean(this.isOpen);
};

/**
 * Atomically increment the shop's OTP counter (1–1000, then reset to 1).
 * Uses MongoDB's atomic findByIdAndUpdate to prevent race conditions.
 * Returns the new counter value as a string.
 * 
 * Production-ready implementation:
 * - Atomic operation (no race conditions)
 * - Cycles 1 → 2 → ... → 1000 → 1
 * - Handles concurrent requests safely
 * - Includes error handling and validation
 */
shopSchema.statics.nextOtpCounter = async function (shopId) {
  if (!shopId) {
    throw new Error('Shop ID is required');
  }

  try {
    // First ensure otpCounter field exists (for old shop documents)
    await this.updateOne(
      { _id: shopId, otpCounter: { $exists: false } },
      { $set: { otpCounter: 0 } }
    );

    // Atomic increment: 1 → 2 → ... → 1000 → 1
    const result = await this.findByIdAndUpdate(
      shopId,
      [
        {
          $set: {
            otpCounter: {
              $cond: [
                { $gte: [{ $ifNull: ['$otpCounter', 0] }, 1000] },
                1,                                          // Reset to 1 after 1000
                { $add: [{ $ifNull: ['$otpCounter', 0] }, 1] } // Increment by 1
              ]
            }
          }
        }
      ],
      { new: true, select: 'otpCounter' }
    );

    if (!result) {
      throw new Error(`Shop not found: ${shopId}`);
    }

    return result.otpCounter.toString();
  } catch (error) {
    throw new Error(`Failed to generate OTP: ${error.message}`);
  }
};

module.exports = mongoose.model('Shop', shopSchema);
