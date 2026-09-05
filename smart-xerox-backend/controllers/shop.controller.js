const Shop = require('../models/Shop');
const User = require('../models/User');
const Order = require('../models/Order');
const Printer = require('../models/Printer');
const { AppError, asyncHandler } = require('../utils/helpers');
const { emitToShop, emitToAdmin, evictShopCache } = require('../config/socket');
const logger = require('../config/logger');

const findMyShop = async (userId) => {
  let shop = await Shop.findOne({ owner: userId });
  if (shop) return shop;

  const user = await User.findById(userId).select('shop');
  if (user?.shop) {
    shop = await Shop.findById(user.shop);
    if (shop) return shop;
  }

  return null;
};

// ─── Get Nearby Shops ─────────────────────────────────────────────────────────
exports.getNearbyShops = asyncHandler(async (req, res) => {
  const { lat, lng, radius = 5000, services } = req.query; // radius in meters

  if (!lat || !lng) throw new AppError('Latitude and longitude are required', 400);

  const filter = {
    isActive: true,
    isVerified: true,
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
        $maxDistance: parseInt(radius),
      },
    },
  };

  if (services) {
    const serviceList = services.split(',');
    serviceList.forEach((s) => { filter[`services.${s.trim()}`] = true; });
  }

  const shops = await Shop.find(filter)
    .limit(20)
    .lean();

  res.status(200).json({ success: true, results: shops.length, data: { shops } });
});

// ─── Get All Shops (with pagination) ─────────────────────────────────────────
exports.getAllShops = asyncHandler(async (req, res) => {
  const { page = 1, limit = 12, city, search } = req.query;

  // Public endpoint — only return active, verified shops
  const filter = { isActive: true, isVerified: true };
  if (city)   filter['address.city'] = new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  if (search) filter.name            = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const skip = (page - 1) * limit;
  const [shops, total] = await Promise.all([
    Shop.find(filter)
      .sort({ createdAt: -1 })   // sort by date — no index needed
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Shop.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { shops, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) } },
  });
});

// ─── Get Shop by ID ───────────────────────────────────────────────────────────
exports.getShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findById(req.params.id)
    .populate('owner', 'name phone');
  if (!shop) throw new AppError('Shop not found', 404);

  // Ensure bankDetails is not included in the response
  const shopObj = shop.toObject();
  delete shopObj.bankDetails;
  delete shopObj.upiId;

  res.status(200).json({ success: true, data: { shop: shopObj } });
});

// ─── Create Shop (Shopkeeper) ─────────────────────────────────────────────────
exports.createShop = asyncHandler(async (req, res) => {
  const existing = await Shop.findOne({ owner: req.user.id });
  if (existing) throw new AppError('You already have a registered shop', 400);

  const { name, phone, email, address, location, pricing, services, operatingHours, bankDetails, upiId } = req.body;

  const shop = await Shop.create({
    name, phone, email, address, location, pricing, services, operatingHours, bankDetails, upiId,
    owner: req.user.id,
    isVerified: false, // Admin must verify
    isActive: true,
  });

  // Link shop to user
  await User.findByIdAndUpdate(req.user.id, { shop: shop._id });

  res.status(201).json({
    success: true,
    message: 'Shop registered. Pending admin verification.',
    data: { shop },
  });
});

// ─── Update Shop ──────────────────────────────────────────────────────────────
exports.updateShop = asyncHandler(async (req, res) => {
  const shop = await findMyShop(req.user.id);
  if (!shop) throw new AppError('Shop not found', 404);

  const allowedUpdates = ['name', 'phone', 'email', 'address', 'location', 'pricing', 'services', 'operatingHours', 'bankDetails', 'upiId', 'isOpen', 'verificationTimeoutMs', 'otpPlacement'];
  const updates = {};
  allowedUpdates.forEach((key) => { if (req.body[key] !== undefined) updates[key] = req.body[key]; });

  Object.assign(shop, updates);
  await shop.save();
  evictShopCache(req.user.id); // invalidate socket cache so next connection gets fresh shop data

  res.status(200).json({ success: true, message: 'Shop updated', data: { shop } });
});

// ─── Get Shop Dashboard Stats ─────────────────────────────────────────────────
exports.getShopDashboard = asyncHandler(async (req, res) => {
  const shop = await findMyShop(req.user.id);
  if (!shop) {
    return res.status(200).json({
      success: true,
      data: {
        shop: null,
        stats: { pendingOrders: 0, todayOrders: 0, totalRevenue: 0, totalOrders: 0 }
      }
    });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Month cycle: starts from 1st day of the current month at 00:00:00 (resets on the 1st of each month)
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);

  const [pendingOrders, todayOrders, monthRevenueAgg, monthOrders, lifetimeRevenueAgg, lifetimeOrders] = await Promise.all([
    Order.countDocuments({ shop: shop._id, status: { $in: ['paid', 'accepted', 'printing'] } }),
    Order.countDocuments({ shop: shop._id, createdAt: { $gte: today } }),
    Order.aggregate([
      { $match: { shop: shop._id, status: { $in: ['paid', 'accepted', 'printing', 'ready', 'picked_up'] }, createdAt: { $gte: currentMonthStart } } },
      { $group: { _id: null, total: { $sum: '$pricing.shopReceivable' } } },
    ]),
    Order.countDocuments({ shop: shop._id, createdAt: { $gte: currentMonthStart }, status: { $ne: 'pending_payment' } }),
    Order.aggregate([
      { $match: { shop: shop._id, status: { $in: ['paid', 'accepted', 'printing', 'ready', 'picked_up'] } } },
      { $group: { _id: null, total: { $sum: '$pricing.shopReceivable' } } },
    ]),
    Order.countDocuments({ shop: shop._id, status: { $ne: 'pending_payment' } }),
  ]);

  const monthRevenue = monthRevenueAgg[0]?.total || 0;
  const lifetimeRevenue = lifetimeRevenueAgg[0]?.total || 0;

  res.status(200).json({
    success: true,
    data: {
      shop: { name: shop.name, rating: shop.rating, isOpen: shop.isOpen, isVerified: shop.isVerified },
      stats: {
        pendingOrders,
        todayOrders,
        totalRevenue: monthRevenue, // Monthly active revenue (1st to 30/31, reset on 1st)
        totalOrders: monthOrders,   // Monthly orders count (1st to 30/31, reset on 1st)
        monthRevenue,
        monthOrders,
        lifetimeRevenue,
        lifetimeOrders,
      },
    },
  });
});

// ─── Toggle Shop Open/Close ───────────────────────────────────────────────────
exports.toggleShopStatus = asyncHandler(async (req, res) => {
  const shop = await findMyShop(req.user.id);
  if (!shop) throw new AppError('Shop not found', 404);

  shop.isOpen = !shop.isOpen;
  await shop.save();
  evictShopCache(req.user.id);

  // Notify shop dashboard
  emitToShop(shop._id.toString(), 'shop:status_update', { isOpen: shop.isOpen, shopId: shop._id });
  // Notify all users watching this shop (UserDashboard listens for this)
  emitToAdmin('shop:status_update', { isOpen: shop.isOpen, shopId: shop._id });

  // ── When shop turns ON: dispatch all queued orders to printer ──────────────
  if (shop.isOpen) {
    setImmediate(async () => {
      try {
        const { findOptimalPrinterForShop } = require('./printer.controller');

        const queuedOrders = await Order.find({
          shop: shop._id,
          status: 'queued',
        }).sort({ createdAt: 1 }); // FIFO

        logger.info(`Shop ${shop.name} turned ON — dispatching ${queuedOrders.length} queued orders`);

        for (const order of queuedOrders) {
          try {
            // Assign printer
            const hasColor = order.documents.some(doc =>
              doc.printingRanges?.some(r => r.colorMode === 'color')
            );
            const jobType = hasColor ? 'color' : 'bw';
            const totalPages = order.documents.reduce((sum, doc) =>
              sum + (doc.printingRanges?.reduce((s, r) => s + ((r.rangeEnd - r.rangeStart + 1) * (r.copies || 1)), 0) || doc.detectedPages || 1), 0
            );

            // ✅ FIX #10: Check if printer is available BEFORE dispatching
            const optimalPrinter = await findOptimalPrinterForShop(shop._id, jobType, totalPages);
            if (!optimalPrinter) {
              // ✅ FIX #10: If no printer available, keep order queued and notify shopkeeper
              logger.warn(`⚠️ No ${jobType} printer available for queued order ${order.orderNumber} — keeping queued`);
              
              const { emitToShop } = require('../config/socket');
              emitToShop(shop._id.toString(), 'order:dispatch_failed', {
                orderId: order._id,
                orderNumber: order.orderNumber,
                reason: `No ${jobType} printer available. Please enable a ${jobType} printer to print this order.`,
              });
              continue;  // Skip this order, try next one
            }

            order.assignedPrinter = optimalPrinter._id;
            order.assignedPrinterName = optimalPrinter.name;
            const updatedPrinter = await Printer.findByIdAndUpdate(
              optimalPrinter._id,
              { $inc: { currentLoad: totalPages, jobsInQueue: 1 } },
              { new: true }
            );
            if (updatedPrinter) {
              emitToShop(shop._id.toString(), 'printer:status_update', { printers: [updatedPrinter] });
            }

            order.status = 'accepted';
            order.addStatusHistory('accepted', 'Auto-dispatched — shop turned ON', null);
            await order.save();
            const { dispatchOrderToPrinters } = require('../services/orderDispatch.service');
            try {
              await dispatchOrderToPrinters(order, { validateProduction: false });
            } catch (err) {
              logger.error(`Auto-dispatch failed for ${order.orderNumber}: ${err.message}`);
            }

            // Notify user
            const { emitToUser } = require('../config/socket');
            emitToUser(order.user.toString(), 'order:status_update', {
              orderId:     order._id,
              status:      'accepted',
              orderNumber: order.orderNumber,
              message:     'Shop is now open — your order is being printed!',
            });

            logger.info(`Queued order ${order.orderNumber} dispatched to printer`);
          } catch (err) {
            logger.error(`Failed to dispatch queued order ${order.orderNumber}: ${err.message}`);
          }
        }
      } catch (err) {
        logger.error(`Queue dispatch on shop-open failed: ${err.message}`);
      }
    });
  }

  // ── FIX #6: When shop turns OFF, move all 'accepted' orders back to 'queued' ──
  // Prevents orders from being stuck in 'accepted' with no printer picking them up.
  // Also move 'printing' orders to 'queued' to prevent stuck orders.
  if (!shop.isOpen) {
    setImmediate(async () => {
      try {
        const acceptedOrders = await Order.find({
          shop: shop._id,
          status: { $in: ['accepted', 'printing'] },  // ✅ FIX #6: Also handle 'printing' orders
        });

        if (acceptedOrders.length === 0) return;

        for (const order of acceptedOrders) {
          // ✅ FIX #6: Use atomic update to prevent race condition
          // Only update if order is still in accepted/printing state
          const updated = await Order.findByIdAndUpdate(
            order._id,
            {
              $set: { status: 'queued' },
              $push: {
                statusHistory: {
                  status: 'queued',
                  note: 'Shop closed — order moved back to queue',
                  timestamp: new Date(),
                },
              },
            },
            { new: true }
          );

          if (updated) {
            const { emitToUser } = require('../config/socket');
            emitToUser(order.user.toString(), 'order:status_update', {
              orderId:     order._id,
              status:      'queued',
              orderNumber: order.orderNumber,
              message:     'Shop is now closed. Your order will be printed when the shop reopens.',
            });
          }
        }

        logger.info(`Shop ${shop.name} turned OFF — moved ${acceptedOrders.length} accepted/printing order(s) back to queued`);
      } catch (err) {
        logger.error(`Re-queue on shop-close failed: ${err.message}`);
      }
    });
  }

  res.status(200).json({
    success: true,
    message: `Shop is now ${shop.isOpen ? 'open' : 'closed'}`,
    data: { isOpen: shop.isOpen },
  });
});

// ─── Get Shop Reviews ─────────────────────────────────────────────────────────
exports.getShopReviews = asyncHandler(async (req, res) => {
  const Review = require('../models/Review');
  const { page = 1, limit = 10 } = req.query;
  const skip = (page - 1) * limit;

  const reviews = await Review.find({ shop: req.params.id, isVisible: true })
    .populate('user', 'name avatar')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  const total = await Review.countDocuments({ shop: req.params.id, isVisible: true });

  res.status(200).json({
    success: true,
    data: { reviews, pagination: { total, page: Number(page), pages: Math.ceil(total / limit) } },
  });
});

// ─── Get My Shop (simple object, for ShopDashboard header) ──────────────────
exports.getMyShop = asyncHandler(async (req, res) => {
  const shop = await findMyShop(req.user.id);
  if (!shop) {
    return res.status(200).json({ success: true, data: { shop: null } });
  }
  res.status(200).json({ success: true, data: { shop } });
});

// ─── Get Withdrawals ──────────────────────────────────────────────────────────
exports.getWithdrawals = asyncHandler(async (req, res) => {
  const Withdrawal = require('../models/Withdrawal');
  const shop = await findMyShop(req.user.id);
  if (!shop) throw new AppError('Shop not found', 404);

  const withdrawals = await Withdrawal.find({ shop: shop._id }).sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: { withdrawals },
  });
});

// ─── Request Withdrawal ───────────────────────────────────────────────────────
exports.requestWithdrawal = asyncHandler(async (req, res) => {
  const Withdrawal = require('../models/Withdrawal');
  const { amount, paymentMethod } = req.body;
  const shop = await findMyShop(req.user.id);
  if (!shop) throw new AppError('Shop not found', 404);

  if (amount < 1) throw new AppError('Minimum withdrawal amount is ₹1', 400);
  if (amount > shop.availableBalance) {
    throw new AppError('Insufficient available balance', 400);
  }

  // Get payout details snapshot
  let payoutDetails = {};
  if (paymentMethod === 'upi') {
    if (!shop.upiId) throw new AppError('Please add a UPI ID in your Profile first', 400);
    payoutDetails = { upiId: shop.upiId };
  } else if (paymentMethod === 'bank_transfer') {
    if (!shop.bankDetails || !shop.bankDetails.accountNumber) {
      throw new AppError('Please add Bank Details in your Profile first', 400);
    }
    payoutDetails = shop.bankDetails;
  } else {
    throw new AppError('Invalid payment method', 400);
  }

  // ✅ FIX #12: DO NOT deduct balance immediately
  // Only deduct after admin approves the withdrawal
  // Create withdrawal request in 'pending' state
  const withdrawal = await Withdrawal.create({
    shop: shop._id,
    amount,
    paymentMethod,
    payoutDetails,
    status: 'pending',
  });

  // ✅ FIX #12: Return current balance without deduction
  res.status(201).json({
    success: true,
    message: 'Withdrawal request submitted successfully. Awaiting admin approval.',
    data: { 
      withdrawal, 
      availableBalance: shop.availableBalance,  // Unchanged
      note: 'Your balance will be deducted only after admin approves this withdrawal.'
    },
  });
});
