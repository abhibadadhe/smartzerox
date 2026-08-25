const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    review: { type: String, maxlength: 500 },
    isVisible: { type: Boolean, default: true },
  },
  { timestamps: true }
);

reviewSchema.index({ shop: 1 });
reviewSchema.index({ user: 1 });

// Update shop average rating after save
reviewSchema.post('save', async function () {
  const Shop = mongoose.model('Shop');
  const stats = await mongoose.model('Review').aggregate([
    { $match: { shop: this.shop } },
    { $group: { _id: '$shop', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  if (stats.length > 0) {
    await Shop.findByIdAndUpdate(this.shop, {
      rating: Math.round(stats[0].avgRating * 10) / 10,
      totalRatings: stats[0].count,
    });
  }
});

module.exports = mongoose.model('Review', reviewSchema);
