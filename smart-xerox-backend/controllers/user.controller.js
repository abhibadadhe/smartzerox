const User = require('../models/User');
const Order = require('../models/Order');
const Shop = require('../models/Shop');
const { AppError, asyncHandler } = require('../utils/helpers');

exports.getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).populate('shop', 'name isVerified isActive rating');
  res.status(200).json({ success: true, data: { user } });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const allowedFields = ['name', 'address', 'fcmToken'];
  const updates = {};
  allowedFields.forEach((field) => { if (req.body[field] !== undefined) updates[field] = req.body[field]; });

  const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true, runValidators: true });
  res.status(200).json({ success: true, message: 'Profile updated', data: { user } });
});

exports.getOrderHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip   = (page - 1) * limit;
  const filter = { user: req.user.id, hiddenFromUser: { $ne: true } };

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate('shop', 'name address rating')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Order.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { orders, pagination: { total, page: Number(page), pages: Math.ceil(total / limit) } },
  });
});

exports.getUserStats = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('totalOrders totalSpent');
  const activeOrders = await Order.countDocuments({
    user: req.user.id,
    status: { $in: ['paid', 'accepted', 'printing', 'ready'] },
  });

  res.status(200).json({
    success: true,
    data: { totalOrders: user.totalOrders, totalSpent: user.totalSpent, activeOrders },
  });
});

// ─── Change Linked Shop ───────────────────────────────────────────────────────
exports.changeShop = asyncHandler(async (req, res) => {
  const { shopId } = req.body;
  if (!shopId) throw new AppError('Shop ID is required', 400);

  const shop = await Shop.findById(shopId).select('name isActive isOpen');
  if (!shop) throw new AppError('Shop not found', 404);
  if (!shop.isActive) throw new AppError('This shop is not currently active', 400);

  const user = await User.findByIdAndUpdate(
    req.user.id,
    { shop: shop._id },
    { new: true, runValidators: true }
  ).populate('shop', 'name isActive isVerified isOpen');

  res.status(200).json({
    success: true,
    message: `Shop changed to ${shop.name}`,
    data: { user },
  });
});
