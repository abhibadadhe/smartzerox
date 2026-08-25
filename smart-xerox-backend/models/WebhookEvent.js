const mongoose = require('mongoose');

const webhookEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, index: true },
    eventType: { type: String, required: true, index: true },
    razorpayOrderId: { type: String, index: true },
    razorpayPaymentId: { type: String },
    status: {
      type: String,
      enum: ['processed', 'failed', 'retry_pending'],
      default: 'processed',
      index: true,
    },
    error: { type: String },
    retryCount: { type: Number, default: 0 },
    nextRetryAt: { type: Date, index: true },
    processedAt: { type: Date },
    payloadSummary: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

webhookEventSchema.index({ status: 1, nextRetryAt: 1 });

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
