const User = require('../models/User');
const Shop = require('../models/Shop');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const Settings = require('../models/Settings');
const { AppError, asyncHandler } = require('../utils/helpers');
const { emitToAdmin, emitToShop } = require('../config/socket');
const { createNotification } = require('../utils/notifications');
const logger = require('../config/logger');
const moment = require('moment');

// ─── Dashboard Overview ───────────────────────────────────────────────────────
exports.getDashboard = asyncHandler(async (req, res) => {
  const today = moment().startOf('day').toDate();
  const thisMonth = moment().startOf('month').toDate();

  const [
    totalUsers, totalShops, totalOrders, activeOrders,
    todayOrders, monthRevenue, pendingVerification,
    recentOrders
  ] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    Shop.countDocuments({ isActive: true }),
    Order.countDocuments(),
    Order.countDocuments({ status: { $in: ['paid', 'accepted', 'printing', 'ready'] } }),
    Order.countDocuments({ createdAt: { $gte: today } }),
    Payment.aggregate([
      { $match: { status: 'paid', paidAt: { $gte: thisMonth } } },
      { $group: { _id: null, total: { $sum: '$platformRevenue' } } },
    ]),
    Shop.countDocuments({ isVerified: false, isActive: true }),
    Order.find().sort({ createdAt: -1 }).limit(10)
      .populate('user', 'name email')
      .populate('shop', 'name')
      .lean(),
  ]);

  res.status(200).json({
    success: true,
    data: {
      stats: {
        totalUsers,
        totalShops,
        totalOrders,
        activeOrders,
        todayOrders,
        monthPlatformRevenue: monthRevenue[0]?.total || 0,
        pendingVerification,
      },
      recentOrders,
    },
  });
});

// ─── Get All Users ─────────────────────────────────────────────────────────────
exports.getAllUsers = asyncHandler(async (req, res) => {
  const { role, page = 1, limit = 20, search, isActive } = req.query;
  const filter = {};
  if (role) filter.role = role;
  if (isActive !== undefined) filter.isActive = isActive === 'true';
  if (search) {
    // Escape regex special chars to prevent ReDoS
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: new RegExp(escaped, 'i') },
      { email: new RegExp(escaped, 'i') },
      { phone: new RegExp(escaped, 'i') },
    ];
  }

  const skip = (page - 1) * limit;
  logger.info('[admin.getAllUsers] Using safe projection without otp parent field to avoid projection collisions (otp subfields excluded by schema)');
  const [users, total] = await Promise.all([
    User.find(filter)
      .select('-password -refreshToken -passwordChangedAt -fcmToken')
      .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    User.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { users, pagination: { total, page: Number(page), pages: Math.ceil(total / limit) } },
  });
});

// ─── Deactivate / Activate User ───────────────────────────────────────────────
exports.toggleUserStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);
  if (user.role === 'admin') throw new AppError('Cannot deactivate admin', 403);

  user.isActive = !user.isActive;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: `User ${user.isActive ? 'activated' : 'deactivated'}`,
    data: { userId: user._id, isActive: user.isActive },
  });
});

// ─── Get All Shops ────────────────────────────────────────────────────────────
exports.getAllShops = asyncHandler(async (req, res) => {
  const { isVerified, isActive, page = 1, limit = 20, search } = req.query;
  const filter = {};
  if (isVerified !== undefined) filter.isVerified = isVerified === 'true';
  if (isActive !== undefined) filter.isActive = isActive === 'true';
  if (search) filter.$or = [{ name: new RegExp(search, 'i') }, { 'address.city': new RegExp(search, 'i') }];

  const skip = (page - 1) * limit;
  const [shops, total] = await Promise.all([
    Shop.find(filter).populate('owner', 'name email phone').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    Shop.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { shops, pagination: { total, page: Number(page), pages: Math.ceil(total / limit) } },
  });
});

// ─── Verify Shop ──────────────────────────────────────────────────────────────
exports.verifyShop = asyncHandler(async (req, res) => {
  const { approve, reason } = req.body;
  const shop = await Shop.findById(req.params.id).populate('owner');
  if (!shop) throw new AppError('Shop not found', 404);

  shop.isVerified = approve;
  if (!approve) shop.isActive = false;
  await shop.save();

  await createNotification({
    recipient: shop.owner._id,
    type: 'shop_verified',
    title: approve ? 'Shop Verified! 🎉' : 'Shop Verification Failed',
    message: approve
      ? `Your shop "${shop.name}" has been verified. You can now receive orders!`
      : `Shop verification failed. Reason: ${reason || 'Please contact support.'}`,
  });

  res.status(200).json({
    success: true,
    message: `Shop ${approve ? 'verified' : 'rejected'}`,
    data: { shop },
  });
});

// ─── Set Platform Margin for Shop ─────────────────────────────────────────────
exports.setShopMargin = asyncHandler(async (req, res) => {
  const { margin } = req.body;
  if (margin === undefined || margin === null) throw new AppError('Margin is required', 400);
  const numMargin = Number(margin);
  if (isNaN(numMargin) || numMargin < 0 || numMargin > 100) throw new AppError('Margin must be between 0 and 100', 400);

  const shop = await Shop.findByIdAndUpdate(req.params.id, { platformMargin: numMargin }, { new: true });
  if (!shop) throw new AppError('Shop not found', 404);

  logger.info(`Admin set platformMargin=${numMargin}% for shop ${shop.name} (${shop._id})`);
  res.status(200).json({ success: true, message: `Platform margin set to ${numMargin}%`, data: { shop } });
});

// ─── Get All Orders ───────────────────────────────────────────────────────────
exports.getAllOrders = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20, from, to, shopId } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (shopId) filter.shop = shopId;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const skip = (page - 1) * limit;
  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate('user', 'name email phone')
      .populate('shop', 'name address')
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

// ─── Revenue Report ───────────────────────────────────────────────────────────
exports.getRevenueReport = asyncHandler(async (req, res) => {
  const { from, to, groupBy = 'day' } = req.query;
  const dateFilter = {};
  if (from) dateFilter.$gte = new Date(from);
  if (to) dateFilter.$lte = new Date(to);

  const groupFormats = { day: '%Y-%m-%d', week: '%Y-W%V', month: '%Y-%m' };
  const dateFormat = groupFormats[groupBy] || groupFormats.day;

  const revenue = await Payment.aggregate([
    { $match: { status: 'paid', ...(Object.keys(dateFilter).length ? { paidAt: dateFilter } : {}) } },
    {
      $group: {
        _id: { $dateToString: { format: dateFormat, date: '$paidAt' } },
        totalRevenue: { $sum: '$amount' },
        platformRevenue: { $sum: '$platformRevenue' },
        shopRevenue: { $sum: '$shopReceivable' },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const totals = await Payment.aggregate([
    { $match: { status: 'paid' } },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$amount' },
        platformRevenue: { $sum: '$platformRevenue' },
        shopRevenue: { $sum: '$shopReceivable' },
        orderCount: { $sum: 1 },
      },
    },
  ]);

  res.status(200).json({ success: true, data: { revenue, totals: totals[0] || {} } });
});

// ─── Broadcast Notification ───────────────────────────────────────────────────
exports.broadcastNotification = asyncHandler(async (req, res) => {
  const { title, message, targetRole, targetUserIds } = req.body;

  if (!title?.trim() || !message?.trim()) throw new AppError('Title and message are required', 400);
  if (title.length > 100) throw new AppError('Title too long (max 100 chars)', 400);
  if (message.length > 500) throw new AppError('Message too long (max 500 chars)', 400);
  if (targetRole && !['user', 'shopkeeper', 'admin'].includes(targetRole)) {
    throw new AppError('Invalid target role', 400);
  }

  let recipients = [];
  if (targetUserIds && targetUserIds.length > 0) {
    recipients = targetUserIds;
  } else if (targetRole) {
    const users = await User.find({ role: targetRole, isActive: true }).select('_id');
    recipients = users.map((u) => u._id);
  } else {
    const users = await User.find({ isActive: true }).select('_id');
    recipients = users.map((u) => u._id);
  }

  // Bulk create notifications
  const notifications = recipients.map((userId) => ({
    recipient: userId,
    type: 'system',
    title,
    message,
    priority: 'high',
  }));
  await Notification.insertMany(notifications);

  // Emit to connected clients
  emitToAdmin('broadcast:notification', { title, message });

  res.status(200).json({
    success: true,
    message: `Notification broadcast to ${recipients.length} users`,
    data: { sentTo: recipients.length },
  });
});

// ─── Get System Announcement & Maintenance Mode (Public + Admin) ───────────────
exports.getSystemAnnouncement = asyncHandler(async (req, res) => {
  const settings = await Settings.getGlobal();
  res.status(200).json({
    success: true,
    data: {
      maintenanceMode: settings.maintenanceMode || false,
      systemAnnouncement: settings.systemAnnouncement || '',
      announcementType: settings.announcementType || 'maintenance',
    },
  });
});

// ─── Update System Announcement & Broadcast to All Users ─────────────────────
exports.updateSystemAnnouncement = asyncHandler(async (req, res) => {
  const { maintenanceMode, systemAnnouncement, announcementType, sendNotification = true } = req.body;

  const update = {};
  if (maintenanceMode !== undefined) update.maintenanceMode = Boolean(maintenanceMode);
  if (systemAnnouncement !== undefined) update.systemAnnouncement = String(systemAnnouncement).trim().slice(0, 500);
  if (announcementType && ['info', 'warning', 'maintenance', 'error'].includes(announcementType)) {
    update.announcementType = announcementType;
  }

  const settings = await Settings.findOneAndUpdate(
    { key: 'global' },
    { $set: update },
    { new: true, upsert: true }
  );

  const { emitGlobalAnnouncement } = require('../config/socket');
  const payload = {
    maintenanceMode: settings.maintenanceMode,
    systemAnnouncement: settings.systemAnnouncement,
    announcementType: settings.announcementType,
    updatedAt: new Date().toISOString(),
  };

  // Real-time broadcast to all connected users & shopkeepers over socket
  emitGlobalAnnouncement('system:announcement', payload);

  // If sendNotification is enabled, bulk send in-app notification to all users
  if (sendNotification && settings.systemAnnouncement) {
    try {
      const activeUsers = await User.find({ isActive: true }).select('_id');
      const notifications = activeUsers.map((u) => ({
        recipient: u._id,
        type: 'system',
        title: settings.maintenanceMode ? '🛠️ System Maintenance Notice' : '📢 System Announcement',
        message: settings.systemAnnouncement,
        priority: 'high',
      }));
      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
      }
    } catch (notifErr) {
      logger.warn(`Failed to create broadcast notifications: ${notifErr.message}`);
    }
  }

  logger.info(`Admin updated system announcement (maintenance: ${settings.maintenanceMode}): "${settings.systemAnnouncement}"`);

  res.status(200).json({
    success: true,
    message: 'System announcement updated and broadcast to all users successfully!',
    data: payload,
  });
});

// ─── Get Platform Analytics ───────────────────────────────────────────────────
exports.getAnalytics = asyncHandler(async (req, res) => {
  const [ordersByStatus, topShops, orderTrend] = await Promise.all([
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Shop.find({ isActive: true, isVerified: true }).sort({ totalOrders: -1 }).limit(10).select('name totalOrders totalRevenue rating'),
    Order.aggregate([
      { $match: { status: { $ne: 'pending_payment' } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 30 },
    ]),
  ]);

  res.status(200).json({ success: true, data: { ordersByStatus, topShops, orderTrend: orderTrend.reverse() } });
});

// ─── Get Global Commission Settings ──────────────────────────────────────────
exports.getCommissionSettings = asyncHandler(async (req, res) => {
  const settings = await Settings.getGlobal();
  res.status(200).json({
    success: true,
    data: {
      defaultCommissionRate: settings.defaultCommissionRate,
      commissionLabel: settings.commissionLabel,
    },
  });
});

// ─── Update Global Commission Rate ───────────────────────────────────────────
exports.updateCommissionSettings = asyncHandler(async (req, res) => {
  const { defaultCommissionRate, commissionLabel } = req.body;

  if (defaultCommissionRate === undefined) throw new AppError('defaultCommissionRate is required', 400);
  const rate = Number(defaultCommissionRate);
  if (isNaN(rate) || rate < 0 || rate > 100) throw new AppError('Commission rate must be between 0 and 100', 400);

  const update = { defaultCommissionRate: rate };
  if (commissionLabel && typeof commissionLabel === 'string') {
    update.commissionLabel = commissionLabel.trim().slice(0, 100);
  }

  const settings = await Settings.findOneAndUpdate(
    { key: 'global' },
    { $set: update },
    { new: true, upsert: true }
  );

  logger.info(`Admin updated global commission rate to ${rate}%`);

  res.status(200).json({
    success: true,
    message: `Global commission rate updated to ${rate}%`,
    data: {
      defaultCommissionRate: settings.defaultCommissionRate,
      commissionLabel: settings.commissionLabel,
    },
  });
});

// ─── Apply Global Commission to All Shops (bulk) ─────────────────────────────
// Sets platformMargin = defaultCommissionRate for every shop that currently has 0% margin.
exports.applyGlobalCommissionToAllShops = asyncHandler(async (req, res) => {
  const { overrideExisting = false } = req.body;
  const settings = await Settings.getGlobal();
  const rate = settings.defaultCommissionRate;

  const filter = overrideExisting ? {} : { platformMargin: { $in: [0, null, undefined] } };
  const result = await Shop.updateMany(filter, { $set: { platformMargin: rate } });

  logger.info(`Admin applied global commission ${rate}% to ${result.modifiedCount} shops (overrideExisting=${overrideExisting})`);

  res.status(200).json({
    success: true,
    message: `Applied ${rate}% commission to ${result.modifiedCount} shop(s)`,
    data: { modifiedCount: result.modifiedCount, rate },
  });
});

// ─── Approve/Reject Withdrawal Request ─────────────────────────────────────────
// ✅ FIX #12: Handle withdrawal approval with balance deduction
exports.approveWithdrawal = asyncHandler(async (req, res) => {
  const Withdrawal = require('../models/Withdrawal');
  const { withdrawalId, approve, reason, transactionId } = req.body;

  if (!withdrawalId) throw new AppError('Withdrawal ID is required', 400);

  const withdrawal = await Withdrawal.findById(withdrawalId).populate('shop');
  if (!withdrawal) throw new AppError('Withdrawal not found', 404);
  if (withdrawal.status !== 'pending') throw new AppError('Withdrawal is not pending', 400);

  const shop = withdrawal.shop;

  if (approve) {
    // ✅ FIX #12: Only deduct balance when admin APPROVES
    // Check balance again (in case it changed)
    if (withdrawal.amount > shop.availableBalance) {
      throw new AppError('Insufficient shop balance for this withdrawal', 400);
    }

    // Deduct balance atomically
    const updated = await Shop.findByIdAndUpdate(
      shop._id,
      {
        $inc: { availableBalance: -withdrawal.amount, withdrawnAmount: withdrawal.amount },
      },
      { new: true }
    );

    if (!updated) {
      throw new AppError('Failed to update shop balance', 500);
    }

    // Mark withdrawal as processing
    withdrawal.status = 'processing';
    withdrawal.transactionId = transactionId || null;
    withdrawal.adminNotes = reason || 'Approved by admin';
    await withdrawal.save();

    logger.info(`✅ Withdrawal ${withdrawalId} approved: ₹${withdrawal.amount} deducted from shop ${shop._id}`);

    // Notify shopkeeper
    await createNotification({
      recipient: shop.owner,
      type: 'withdrawal_approved',
      title: 'Withdrawal Approved! ✅',
      message: `Your withdrawal request of ₹${withdrawal.amount} has been approved and is being processed.`,
    });

    res.status(200).json({
      success: true,
      message: 'Withdrawal approved and balance deducted',
      data: { withdrawal, shopBalance: updated.availableBalance },
    });
  } else {
    // ✅ FIX #12: On rejection, NO balance change (it was never deducted)
    withdrawal.status = 'rejected';
    withdrawal.adminNotes = reason || 'Rejected by admin';
    await withdrawal.save();

    logger.info(`❌ Withdrawal ${withdrawalId} rejected: ₹${withdrawal.amount} (balance unchanged)`);

    // Notify shopkeeper
    await createNotification({
      recipient: shop.owner,
      type: 'withdrawal_rejected',
      title: 'Withdrawal Rejected',
      message: `Your withdrawal request of ₹${withdrawal.amount} has been rejected. Reason: ${reason || 'No reason provided'}. Your balance remains unchanged.`,
    });

    res.status(200).json({
      success: true,
      message: 'Withdrawal rejected. Shop balance unchanged.',
      data: { withdrawal, shopBalance: shop.availableBalance },
    });
  }
});

// ─── Get All Withdrawal Requests ───────────────────────────────────────────────
exports.getAllWithdrawals = asyncHandler(async (req, res) => {
  const Withdrawal = require('../models/Withdrawal');
  const { status, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (status) filter.status = status;

  const skip = (page - 1) * limit;
  const [withdrawals, total] = await Promise.all([
    Withdrawal.find(filter)
      .populate('shop', 'name owner')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Withdrawal.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      withdrawals,
      pagination: { total, page: Number(page), pages: Math.ceil(total / limit) }
    },
  });
});

// @desc    Update Shop Razorpay Linked Account & Split Payment Settings
// @route   PUT /api/admin/shops/:id/razorpay-account
// @access  Private (Admin)
exports.updateShopRazorpayAccount = asyncHandler(async (req, res) => {
  const { razorpayAccountId, commissionPercentage, splitPaymentEnabled } = req.body;

  const updateData = {};
  if (razorpayAccountId !== undefined) updateData.razorpayAccountId = razorpayAccountId ? razorpayAccountId.trim() : null;
  if (commissionPercentage !== undefined) updateData.commissionPercentage = Math.max(0, Math.min(100, Number(commissionPercentage) || 0));
  if (splitPaymentEnabled !== undefined) updateData.splitPaymentEnabled = Boolean(splitPaymentEnabled);

  const shop = await Shop.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
  if (!shop) throw new AppError('Shop not found', 404);

  logger.info(`Admin updated Razorpay Route settings for shop ${shop.name} (${shop._id}): account=${shop.razorpayAccountId}, commission=${shop.commissionPercentage}%, split=${shop.splitPaymentEnabled}`);

  res.status(200).json({
    success: true,
    message: `Updated Razorpay Route settings for ${shop.name}`,
    data: {
      shopId: shop._id,
      razorpayAccountId: shop.razorpayAccountId,
      commissionPercentage: shop.commissionPercentage,
      splitPaymentEnabled: shop.splitPaymentEnabled
    }
  });
});

// @desc    Admin create new shop & shopkeeper account for direct handover
// @route   POST /api/admin/shops/create-with-credentials
// @access  Private (Admin)
exports.createShopWithCredentials = asyncHandler(async (req, res) => {
  const {
    shopName,
    ownerName,
    email,
    phone,
    password,
    street,
    city,
    state,
    pincode,
    razorpayAccountId,
    bwSingleSided,
    bwDoubleSided,
    colorSingleSided,
    colorDoubleSided
  } = req.body;

  if (!shopName || !ownerName || !email || !phone || !password) {
    throw new AppError('Shop name, owner name, email, phone, and password are required', 400);
  }

  // Check or create User
  let user = await User.findOne({ email: email.toLowerCase() });
  if (user) {
    if (user.role === 'user') {
      user.role = 'shopkeeper';
      user.isEmailVerified = true;
      user.isPhoneVerified = true;
      user.isActive = true;
      await user.save();
    }
  } else {
    user = await User.create({
      name: ownerName,
      email: email.toLowerCase(),
      phone,
      password: password, // Mongoose userSchema pre-save hook handles hashing
      role: 'shopkeeper',
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
    });
  }

  // Check if shop already exists for this owner
  const existingShop = await Shop.findOne({ owner: user._id });
  if (existingShop) {
    throw new AppError(`A shop (${existingShop.name}) already exists for this user/email`, 400);
  }

  // Create Shop
  const shop = await Shop.create({
    name: shopName,
    owner: user._id,
    phone,
    email: email.toLowerCase(),
    address: {
      street: street || 'Main Street',
      city: city || 'Pune',
      state: state || 'Maharashtra',
      pincode: pincode || '411001'
    },
    location: {
      type: 'Point',
      coordinates: [73.8567, 18.5204]
    },
    pricing: {
      bw: {
        singleSided: Number(bwSingleSided) || 2,
        doubleSided: Number(bwDoubleSided) || 3
      },
      color: {
        singleSided: Number(colorSingleSided) || 10,
        doubleSided: Number(colorDoubleSided) || 15
      }
    },
    razorpayAccountId: razorpayAccountId ? razorpayAccountId.trim() : null,
    splitPaymentEnabled: Boolean(razorpayAccountId),
    isApproved: true,
    isVerified: true,
    isActive: true,
    isOpen: true
  });

  logger.info(`Admin created shop "${shop.name}" with shopkeeper account ${user.email}`);

  res.status(201).json({
    success: true,
    message: `Shop "${shop.name}" created successfully!`,
    data: {
      shop: {
        id: shop._id,
        name: shop.name,
        phone: shop.phone,
        email: shop.email
      },
      credentials: {
        ownerName: user.name,
        email: user.email,
        password: password,
        loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`
      }
    }
  });
});



// ─── Shop Settlement & Admin Margin Report ───────────────────────────────────
exports.getShopSettlementReport = asyncHandler(async (req, res) => {
  const { shopId, from, to, month } = req.query;
  const mongoose = require('mongoose');

  const now = new Date();
  const currentDay = now.getDate();
  const isSettlementWindowActive = currentDay <= 7; // Available for 7 days after 30th/31st (1st to 7th)

  let startDate = null;
  let endDate = null;
  let periodLabel = 'Custom Period';
  let isMonthClosed = false;

  if (month === 'last_month') {
    const lastMonthDate = moment().subtract(1, 'month');
    startDate = lastMonthDate.clone().startOf('month').toDate();
    endDate = lastMonthDate.clone().endOf('month').toDate();
    periodLabel = `${lastMonthDate.format('MMMM YYYY')} (Closed Month)`;
    isMonthClosed = true;
  } else if (month === 'current') {
    startDate = moment().startOf('month').toDate();
    endDate = moment().endOf('month').toDate();
    periodLabel = `${moment().format('MMMM YYYY')} (Current Month)`;
    isMonthClosed = false;
  } else if (month && /^\d{4}-\d{2}$/.test(month)) {
    const parsedMonth = moment(month, 'YYYY-MM');
    startDate = parsedMonth.clone().startOf('month').toDate();
    endDate = parsedMonth.clone().endOf('month').toDate();
    periodLabel = parsedMonth.format('MMMM YYYY');
    isMonthClosed = parsedMonth.isBefore(moment().startOf('month'));
  } else if (from || to) {
    if (from) startDate = moment(from).startOf('day').toDate();
    if (to) endDate = moment(to).endOf('day').toDate();
    periodLabel = `${from || 'Start'} to ${to || 'Now'}`;
  } else {
    // Default to current month (1st to 30/31)
    startDate = moment().startOf('month').toDate();
    endDate = moment().endOf('month').toDate();
    periodLabel = `${moment().format('MMMM YYYY')} (Current Month)`;
    isMonthClosed = false;
  }

  const match = {
    status: { $in: ['paid', 'accepted', 'printing', 'ready', 'picked_up'] }
  };

  if (shopId && shopId !== 'all' && mongoose.Types.ObjectId.isValid(shopId)) {
    match.shop = new mongoose.Types.ObjectId(shopId);
  }

  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = startDate;
    if (endDate) match.createdAt.$lte = endDate;
  }

  const [orders, allShops] = await Promise.all([
    Order.find(match)
      .populate('shop', 'name owner address phone')
      .populate('user', 'name phone email')
      .sort({ createdAt: -1 })
      .lean(),
    Shop.find({}).populate('owner', 'name email phone').lean()
  ]);

  const shopMap = {};
  (allShops || []).forEach(s => {
    if (!s?._id) return;
    const idStr = s._id.toString();
    shopMap[idStr] = {
      shopId: idStr,
      shopName: s.name || 'Unnamed Shop',
      ownerName: s.owner?.name || 'Shopkeeper',
      ownerPhone: s.owner?.phone || s.phone || '',
      ownerEmail: s.owner?.email || '',
      totalOrders: 0,
      totalRevenue: 0,
      totalDocs: 0,
      totalOrderPages: 0,
      docsOver5Pages: 0,
      adminMarginReceivable: 0,
      shopNetRevenue: 0,
      orders: []
    };
  });

  (orders || []).forEach(order => {
    if (!order) return;
    const sId = order.shop?._id ? order.shop._id.toString() : (order.shop ? order.shop.toString() : 'unknown');
    
    if (!shopMap[sId]) {
      shopMap[sId] = {
        shopId: sId,
        shopName: order.shop?.name || (sId === 'unknown' ? 'Unassigned / Direct Orders' : 'Shop'),
        ownerName: order.shop?.owner?.name || 'Shopkeeper',
        ownerPhone: order.shop?.phone || '',
        ownerEmail: '',
        totalOrders: 0,
        totalRevenue: 0,
        totalDocs: 0,
        totalOrderPages: 0,
        docsOver5Pages: 0,
        adminMarginReceivable: 0,
        shopNetRevenue: 0,
        orders: []
      };
    }

    let orderTotalPages = 0;
    const docs = Array.isArray(order.documents) ? order.documents : [];
    const orderTotalDocs = docs.length || 1;
    
    docs.forEach(doc => {
      if (!doc) return;
      const ranges = Array.isArray(doc.printingRanges) ? doc.printingRanges : [];
      const docPages = ranges.reduce((sum, r) => sum + (((r.rangeEnd || 1) - (r.rangeStart || 1) + 1) * (r.copies || 1)), 0) || (doc.pageCount || doc.detectedPages || 1);
      orderTotalPages += docPages;
    });

    if (orderTotalPages === 0) {
      orderTotalPages = order.totalPages || 1;
    }

    const isOver5Pages = orderTotalPages > 5;
    const totalAmount = Number(order.pricing?.total || order.totalAmount || 0);
    const adminMargin = order.pricing?.platformMargin !== undefined 
      ? Number(order.pricing.platformMargin) 
      : (isOver5Pages ? 1 : 0);
    const shopReceivable = order.pricing?.shopReceivable !== undefined 
      ? Number(order.pricing.shopReceivable) 
      : Math.max(0, totalAmount - adminMargin);

    const targetShop = shopMap[sId];
    targetShop.totalOrders += 1;
    targetShop.totalRevenue += totalAmount;
    targetShop.totalDocs += orderTotalDocs;
    targetShop.totalOrderPages += orderTotalPages;
    if (isOver5Pages) targetShop.docsOver5Pages += 1;
    targetShop.adminMarginReceivable += adminMargin;
    targetShop.shopNetRevenue += shopReceivable;

    targetShop.orders.push({
      orderId: order._id,
      orderNumber: order.orderNumber || order._id?.toString()?.slice(-6)?.toUpperCase(),
      createdAt: order.createdAt,
      customerName: order.user?.name || 'Customer',
      customerPhone: order.user?.phone || '',
      totalDocs: orderTotalDocs,
      totalOrderPages,
      docsOver5Pages: isOver5Pages ? 1 : 0,
      totalAmount,
      adminMargin,
      shopReceivable,
      status: order.status
    });
  });

  const shopSummaries = Object.values(shopMap).filter(s => {
    if (!shopId || shopId === 'all') return true;
    return s.shopId?.toString() === shopId.toString();
  });

  const overallTotals = shopSummaries.reduce((acc, s) => {
    acc.totalOrders += s.totalOrders || 0;
    acc.totalRevenue += s.totalRevenue || 0;
    acc.totalDocs += s.totalDocs || 0;
    acc.totalOrderPages += s.totalOrderPages || 0;
    acc.docsOver5Pages += s.docsOver5Pages || 0;
    acc.adminMarginReceivable += s.adminMarginReceivable || 0;
    acc.shopNetRevenue += s.shopNetRevenue || 0;
    return acc;
  }, { totalOrders: 0, totalRevenue: 0, totalDocs: 0, totalOrderPages: 0, docsOver5Pages: 0, adminMarginReceivable: 0, shopNetRevenue: 0 });

  res.status(200).json({
    success: true,
    data: {
      period: {
        label: periodLabel,
        startDate,
        endDate,
        isClosed: isMonthClosed,
        isSettlementWindowActive,
        daysRemainingInWindow: Math.max(0, 7 - currentDay + 1)
      },
      overallTotals,
      shops: shopSummaries
    }
  });
});

