const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: [
        'order_placed', 'order_accepted', 'order_rejected', 'order_printing',
        'order_ready', 'order_picked_up', 'order_expired', 'order_expiring_soon',
        'payment_success', 'payment_failed', 'payment_refunded',
        'otp', 'system', 'promo', 'shop_verified', 'new_order_shop',
        'order_extended',
      ],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed }, // Extra data (order ID, etc.)
    isRead: { type: Boolean, default: false },
    readAt: Date,
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop' },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // TTL: 30 days

module.exports = mongoose.model('Notification', notificationSchema);
