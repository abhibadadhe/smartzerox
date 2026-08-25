const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema(
  {
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, 'Withdrawal amount must be at least ₹1'],
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'rejected'],
      default: 'pending',
    },
    paymentMethod: {
      type: String,
      enum: ['upi', 'bank_transfer'],
      required: true,
    },
    payoutDetails: {
      type: mongoose.Schema.Types.Mixed, // Stores a snapshot of the UPI ID or Bank Details at the time of request
      required: true,
    },
    transactionId: {
      type: String, // Filled by admin when processing the payment
    },
    adminNotes: {
      type: String,
    },
  },
  { timestamps: true }
);

withdrawalSchema.index({ shop: 1, status: 1 });
withdrawalSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
