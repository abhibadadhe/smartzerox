const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, unique: true, sparse: true },
    razorpaySignature: { type: String },
    amount: { type: Number, required: true }, // Total amount in INR (what customer pays)
    shopReceivable: { type: Number, required: true }, // Amount going to shop (after commission)
    platformRevenue: { type: Number, required: true }, // Platform's commission
    commissionPercent: { type: Number, default: 0 }, // Commission % applied at payment time
    currency: { type: String, default: 'INR' },
    status: {
      type: String,
      enum: ['created', 'attempted', 'paid', 'failed', 'refunded', 'partially_refunded'],
      default: 'created',
    },
    method: String, // card, upi, netbanking, etc.
    bank: String,
    wallet: String,
    vpa: String, // UPI VPA
    email: String,
    contact: String,
    description: String,
    receipt: String,
    notes: mongoose.Schema.Types.Mixed,
    error: {
      code: String,
      description: String,
      source: String,
      step: String,
      reason: String,
    },
    refund: {
      razorpayRefundId: String,
      amount: Number,
      status: String,
      reason: String,
      processedAt: Date,
    },
    webhookVerified: { type: Boolean, default: false },
    paidAt: Date,
    failedAt: Date,
  },
  {
    timestamps: true,
  }
);

paymentSchema.index({ razorpayOrderId: 1 });
paymentSchema.index({ razorpayPaymentId: 1 });
paymentSchema.index({ user: 1, createdAt: -1 });
paymentSchema.index({ shop: 1, status: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
