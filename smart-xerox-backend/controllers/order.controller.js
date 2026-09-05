const Order = require('../models/Order');
const Shop = require('../models/Shop');
const User = require('../models/User');
const Payment = require('../models/Payment');
const Settings = require('../models/Settings');
const Printer = require('../models/Printer');
const PendingUpload = require('../models/PendingUpload');
const { AppError, asyncHandler } = require('../utils/helpers');
const { createRazorpayOrder } = require('../config/razorpay');
const { generateQRCode } = require('../utils/qrcode');  // generatePickupCode removed — using Shop.nextOtpCounter
const { emitToUser, emitToShop, emitToAdmin } = require('../config/socket');
const { createNotification } = require('../utils/notifications');
const { calculateOrderPrice } = require('../utils/pricing');
const { getPresignedUrl, s3Client, BUCKET_NAME } = require('../config/aws');
const { sendEmail } = require('../utils/email');
const logger = require('../config/logger');
const { findOptimalPrinterForShop } = require('./printer.controller');
const { withRazorpay, withS3, withEmail } = require('../utils/circuitBreaker');
const { dispatchOrderToPrinters } = require('../services/orderDispatch.service');
const moment = require('moment');

// ─── Helper: Transition Order to READY + Generate OTP + Notify ────────────────
// Reused by: markAutoPrinted (print agent), updateOrderStatus (manual),
//            updatePrintJob (completed checkpoint).
// Idempotent — skips if order is already 'ready' or 'picked_up'.
async function transitionToReady(order, userId) {
  // Guard: only transition from printing or accepted
  if (!['accepted', 'printing', 'queued'].includes(order.status)) {
    logger.info(`transitionToReady skipped — order ${order.orderNumber} is in '${order.status}' state`);
    return order;
  }

  // ── NEW: If this is a sub-order, check if all siblings are ready ──────────────
  if (order.parentOrder) {
    const { checkAllSubOrdersReady } = require('../services/orderDivision.service');
    const parentOrder = await Order.findById(order.parentOrder);
    
    order.addStatusHistory('ready', 'Sub-order ready (waiting for other color modes)', userId);
    await order.save();

    const allReady = await checkAllSubOrdersReady(parentOrder);
    if (!allReady) {
      logger.info(`Sub-order ${order.orderNumber} ready, but waiting for siblings...`);
      return order;
    }

    logger.info(`✅ All sub-orders ready for parent order ${parentOrder.orderNumber}`);
  }

  // Ensure user + shop are populated
  if (!order.populated('user')) {
    await order.populate('user', 'name email phone');
  }
  if (!order.populated('shop')) {
    await order.populate('shop');
  }

  // OTP already generated at order creation
  const pickupCode = order.pickup.pickupCode;

  // Transition status → ready
  order.addStatusHistory('ready', 'Auto-marked ready — printing completed', userId);
  await order.save();

  logger.info(`Order ${order.orderNumber} → READY. OTP: ${pickupCode}`);

  // ── Release Printer Load & Queue Count ──────────────────────────────────
  if (order.assignedPrinter) {
    try {
      const Printer = require('../models/Printer');
      const totalPages = (order.documents || []).reduce((acc, d) => {
        if (d.printingRanges && d.printingRanges.length > 0) {
          return acc + d.printingRanges.reduce((sum, r) => sum + ((r.rangeEnd - r.rangeStart + 1) * (r.copies || 1)), 0);
        }
        return acc + (d.detectedPages || 1);
      }, 0) || 1;

      const p = await Printer.findById(order.assignedPrinter);
      if (p) {
        p.currentLoad = Math.max(0, (p.currentLoad || 0) - totalPages);
        p.jobsInQueue = Math.max(0, (p.jobsInQueue || 0) - 1);
        await p.save();

        const { getIO } = require('../config/socket');
        try {
          const io = getIO();
          const shopId = (order.shop?._id || order.shop).toString();
          io.to(`shop:${shopId}`).emit('printer:status_update', { printers: [p] });
        } catch (sockErr) {}
      }
    } catch (loadErr) {
      logger.warn(`Failed to decrement printer load: ${loadErr.message}`);
    }
  }


  // ── Notify user (in-app notification) ──────────────────────────────────────
  // Only notify for parent order or non-divided orders (not for each sub-order)
  if (!order.parentOrder) {
    try {
      await createNotification({
        recipient: order.user._id,
        type:      'order_ready',
        title:     'Order Ready for Pickup! ✅',
        message:   `Your order #${order.orderNumber} is ready. Use OTP ${pickupCode} to collect it.`,
        order:     order._id,
      });
    } catch (notifErr) {
      logger.error(`Notification failed for order ${order.orderNumber}: ${notifErr.message}`);
    }
  }

  // ── Send OTP email to user ─────────────────────────────────────────────────
  // Only send once for parent order
  if (order.user?.email && !order.parentOrder) {
    await withEmail(() => sendEmail({
      to:       order.user.email,
      template: 'orderReady',
      data: {
        name:        order.user.name,
        orderNumber: order.orderNumber,
        pickupCode,
        shopName:    order.shop?.name || '',
        shopAddress: order.shop?.address || '',
      },
    }));
  }

  // ── Real-time socket events ────────────────────────────────────────────────
  emitToUser(order.user._id.toString(), 'order:status_update', {
    orderId:     order._id,
    status:      'ready',
    orderNumber: order.orderNumber,
    pickupCode,
  });

  const shopId = order.shop._id?.toString() || order.shop.toString();
  emitToShop(shopId, 'order:status_update', {
    orderId:     order._id,
    status:      'ready',
    orderNumber: order.orderNumber,
  });

  return order;
}

// ─── Create Order ─────────────────────────────────────────────────────────────
exports.createOrder = asyncHandler(async (req, res) => {
  const { shopId, documents, additionalServices, specialInstructions } = req.body;

  // ── Idempotency: prevent duplicate orders from rapid double-submits ──────────
  // Client should send a unique Idempotency-Key header per order attempt.
  // If the same key is seen again, return the existing order instead of creating a new one.
  const idempotencyKey = req.headers['idempotency-key'];
  if (idempotencyKey) {
    const existing = await Order.findOne({
      user: req.user.id,
      idempotencyKey,
    }).populate('shop', 'name');
    if (existing) {
      logger.info(`Idempotent createOrder: returning existing order ${existing._id} for key ${idempotencyKey}`);
      return res.status(200).json({
        success: true,
        message: 'Order already created (idempotent)',
        data: {
          order: existing,
          razorpay: {
            orderId:  existing.payment.razorpayOrderId,
            amount:   Math.round(existing.pricing.total * 100),
            currency: 'INR',
            key:      process.env.RAZORPAY_KEY_ID,
          },
        },
      });
    }
  }

  // ── CRITICAL FIX #6: Prevent duplicate orders within 5 seconds ──────────────
  // Prevents accidental double-orders from rapid double-clicks
  const recentOrder = await Order.findOne({
    user: req.user.id,
    shop: shopId,
    createdAt: { $gte: new Date(Date.now() - 5000) }
  });
  if (recentOrder) {
    logger.warn(`Duplicate order attempt by user ${req.user.id} within 5 seconds`);
    throw new AppError('Order already created. Please wait before placing another.', 409);
  }

  const shop = await Shop.findById(shopId);
  if (!shop) throw new AppError('Shop not found', 404);
  if (!shop.isActive || !shop.isVerified) throw new AppError('Shop is not available', 400);
  // Note: Closed shops (manual toggle OFF or outside operating hours) allow orders to be placed & queued.

  if (!documents || documents.length === 0) {
    throw new AppError('At least one document is required', 400);
  }

  // Validate page ranges for each document
  documents.forEach((doc, docIndex) => {
    if (!doc.printingRanges || doc.printingRanges.length === 0) {
      throw new AppError(`Document ${docIndex + 1}: At least one printing range is required`, 400);
    }
    
    const detectedPages = doc.detectedPages || 1;
    
    doc.printingRanges.forEach((range, rangeIndex) => {
      // ✅ FIX EDGE CASE #2: Enforce explicit colorMode selection (no silent defaults)
      if (!range.colorMode || !['bw', 'color'].includes(range.colorMode)) {
        logger.error(`Order creation REJECTED: Doc ${docIndex + 1}, Range ${rangeIndex + 1}: colorMode not specified or invalid`);
        throw new AppError(
          `Document ${docIndex + 1}, Range ${rangeIndex + 1}: Color mode must be explicitly selected ('bw' or 'color'). ` +
          `Received: ${range.colorMode || 'undefined'}`,
          400
        );
      }
      
      // ✅ FIX EDGE CASE #2: Enforce explicit sides selection (no silent defaults)
      if (!range.sides || !['single', 'double'].includes(range.sides)) {
        logger.error(`Order creation REJECTED: Doc ${docIndex + 1}, Range ${rangeIndex + 1}: sides not specified or invalid`);
        throw new AppError(
          `Document ${docIndex + 1}, Range ${rangeIndex + 1}: Print sides must be explicitly selected ('single' or 'double'). ` +
          `Received: ${range.sides || 'undefined'}`,
          400
        );
      }
      
      // Sanitize range values
      let rangeStart = parseInt(range.rangeStart);
      let rangeEnd = parseInt(range.rangeEnd);
      let copies = parseInt(range.copies);
      
      // CRITICAL FIX: Ensure values are valid numbers
      if (isNaN(rangeStart) || rangeStart < 1) rangeStart = 1;
      if (isNaN(rangeEnd) || rangeEnd < 1) rangeEnd = detectedPages;
      if (isNaN(copies) || copies < 1) copies = 1;
      
      // Clamp values to valid ranges
      rangeStart = Math.max(1, Math.min(rangeStart, detectedPages));
      rangeEnd = Math.max(rangeStart, Math.min(rangeEnd, detectedPages));
      copies = Math.max(1, Math.min(copies, 100));
      
      if (rangeStart < 1 || rangeEnd > detectedPages || rangeStart > rangeEnd) {
        throw new AppError(`Document ${docIndex + 1}, Range ${rangeIndex + 1}: Invalid page range ${rangeStart}-${rangeEnd} for ${detectedPages} pages`, 400);
      }
      
      if (copies < 1 || copies > 100) {
        throw new AppError(`Document ${docIndex + 1}, Range ${rangeIndex + 1}: Copies must be between 1 and 100`, 400);
      }
      
      // Update the range with sanitized values
      range.rangeStart = rangeStart;
      range.rangeEnd = rangeEnd;
      range.copies = copies;
      
      logger.info(`Order validation: Doc ${docIndex + 1}, Range ${rangeIndex + 1}: pages ${rangeStart}-${rangeEnd}, copies ${copies}`);
    });
  });

  // ✅ FIX #3: Enforce maximum order size to prevent integer overflow in pricing
  // Calculate total pages across all documents and ranges
  const totalPages = documents.reduce((sum, doc) => {
    return sum + doc.printingRanges.reduce((pageSum, range) => {
      const rangePages = (range.rangeEnd - range.rangeStart + 1) * range.copies;
      return pageSum + rangePages;
    }, 0);
  }, 0);

  // ✅ PRODUCTION FIX: Enhanced bulk order validation
  const MAX_ORDER_PAGES = parseInt(process.env.MAX_ORDER_PAGES) || 10000;
  const MAX_DOCUMENTS = parseInt(process.env.MAX_DOCUMENTS) || 10;
  const MAX_RANGES_PER_DOC = parseInt(process.env.MAX_RANGES_PER_DOC) || 50;

  // Validate document count for bulk orders
  if (documents.length > MAX_DOCUMENTS) {
    throw new AppError(
      `Too many documents. Maximum ${MAX_DOCUMENTS} documents allowed per order.`,
      400
    );
  }

  // Validate ranges per document for bulk orders
  for (const doc of documents) {
    if (doc.printingRanges?.length > MAX_RANGES_PER_DOC) {
      throw new AppError(
        `Document "${doc.originalName}" has too many print ranges. Maximum ${MAX_RANGES_PER_DOC} ranges per document.`,
        400
      );
    }
  }

  if (totalPages > MAX_ORDER_PAGES) {
    logger.warn(`⚠️ Order rejected: ${totalPages} pages exceeds limit of ${MAX_ORDER_PAGES} (user: ${req.user.id}, shop: ${shopId})`);
    throw new AppError(
      `Order size exceeds maximum limit of ${MAX_ORDER_PAGES.toLocaleString()} pages. ` +
      `Your order has ${totalPages.toLocaleString()} pages. Please split into smaller orders.`,
      400
    );
  }

  // ✅ PRODUCTION FIX: Warn for large orders (80% of max) - helps monitor system capacity
  if (totalPages > MAX_ORDER_PAGES * 0.8) {
    logger.warn(`⚠️ Large order: ${totalPages} pages (${((totalPages / MAX_ORDER_PAGES) * 100).toFixed(1)}% of max) - user: ${req.user.id}, shop: ${shopId}`);
  }

  logger.info(`✅ Order validated: ${totalPages} total pages, ${documents.length} docs (limits: ${MAX_ORDER_PAGES} pages, ${MAX_DOCUMENTS} docs)`);

  // Fetch global commission rate — used when shop has no custom margin set
  const platformSettings = await Settings.getGlobal();
  const globalCommissionRate = platformSettings.defaultCommissionRate || 0;

  const { subtotal, documentPrices, additionalCharge, total, shopReceivable, platformMargin, commissionPercent } =
    calculateOrderPrice(documents, shop, additionalServices, globalCommissionRate);

  const orderDocuments = documents.map((doc, i) => ({
    ...doc,
    price: documentPrices[i],
  }));

  const receipt = `order_${Date.now()}`;
  let razorpayOrder;
  try {
    razorpayOrder = await withRazorpay(() => createRazorpayOrder({
      amount: total,
      currency: 'INR',
      receipt,
      notes: { shopId, userId: req.user.id },
    }));
  } catch (err) {
    logger.error(`Razorpay order creation failed: ${err.message}`);
    throw new AppError(err.message || 'Payment gateway unavailable. Please try again.', 502);
  }

  // Generate OTP immediately (1-1000 per shop)
  const otp = await Shop.nextOtpCounter(shopId);
  const qrData = JSON.stringify({ orderId: null, otp, orderNumber: null });  // orderNumber will be assigned after payment
  let qrCode = null;
  try {
    qrCode = await generateQRCode(qrData);
  } catch (qrErr) {
    logger.warn(`QR generation failed for OTP ${otp}: ${qrErr.message}`);
  }

  let order;
  try {
    order = await Order.create({
      user: req.user.id,
      shop: shopId,
      documents: orderDocuments,
      additionalServices: additionalServices || {},
      specialInstructions,
      pricing: {
        subtotal,
        platformMargin,
        commissionPercent: commissionPercent || 0,
        additionalServicesCharge: additionalCharge,
        total,
        shopReceivable,
      },
      status: 'pending_payment',
      payment: {
        razorpayOrderId: razorpayOrder.id,
        status: 'pending',
      },
      statusHistory: [{ status: 'pending_payment', note: 'Order created, awaiting payment' }],
      // Generate OTP immediately
      pickup: {
        pickupCode: otp,
        qrCodeData: qrData,
        qrCode: qrCode || undefined
      },
      // ── CRITICAL FIX: DO NOT assign orderNumber until payment is successful ──
      orderNumber: null,  // Will be assigned after payment verification
      // Idempotency key — stored so duplicate requests return the same order
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  } catch (err) {
    // Unique idempotency index can race under concurrency: return existing order safely
    if (err?.code === 11000 && idempotencyKey) {
      const existing = await Order.findOne({ user: req.user.id, idempotencyKey }).populate('shop', 'name');
      if (existing) {
        logger.info(`Idempotent createOrder (duplicate key): returning existing order ${existing._id} for key ${idempotencyKey}`);
        return res.status(200).json({
          success: true,
          message: 'Order already created (idempotent)',
          data: {
            order: existing,
            razorpay: {
              orderId:  existing.payment?.razorpayOrderId || razorpayOrder.id,
              amount:   Math.round(existing.pricing.total * 100),
              currency: 'INR',
              key:      process.env.RAZORPAY_KEY_ID,
            },
          },
        });
      }
    }
    throw err;
  }

  await Payment.create({
    order: order._id,
    user: req.user.id,
    shop: shopId,
    razorpayOrderId: razorpayOrder.id,
    amount: total,
    shopReceivable,
    platformRevenue: platformMargin,
    currency: 'INR',
    receipt,
  });

  // ── Mark uploaded files as claimed so orphan cleanup skips them ───────────
  // Non-blocking — a failure here must NOT fail the order creation response.
  // We extend expiresAt to 24h from now so the TTL index cleans up the record
  // automatically after the order lifecycle is well underway.
  const s3Keys = orderDocuments.map(d => d.s3Key).filter(Boolean);
  if (s3Keys.length > 0) {
    const claimedExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h from now
    PendingUpload.updateMany(
      { s3Key: { $in: s3Keys }, userId: req.user.id },
      { $set: { status: 'claimed', expiresAt: claimedExpiry } }
    ).catch(err => logger.warn(`PendingUpload claim failed for order ${order._id}: ${err.message}`));
  }

  res.status(201).json({
    success: true,
    message: 'Order created successfully',
    data: {
      order,
      razorpay: {
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        key: process.env.RAZORPAY_KEY_ID,
      },
    },
  });
});

// ─── Get User Orders ──────────────────────────────────────────────────────────
exports.getUserOrders = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query;
  const filter = {
    user: req.user.id,
    hiddenFromUser: { $ne: true },   // exclude auto-hidden orders (>24h terminal)
    // ── CRITICAL FIX: Exclude pending_payment orders (not yet assigned order number) ──
    status: { $ne: 'pending_payment' },  // Only show orders after successful payment
  };
  if (status) filter.status = status;

  const skip = (page - 1) * limit;
  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate('shop', 'name address phone rating')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Order.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      orders,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) },
    },
  });
});

// ─── Get Single Order ─────────────────────────────────────────────────────────
exports.getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('user', 'name email phone')
    .populate('shop', 'name address phone email otpPlacement owner');

  if (!order) throw new AppError('Order not found', 404);

  const isOwner = order.user._id.toString() === req.user.id;
  const isShopOwner = req.user.role === 'shopkeeper' &&
    order.shop.owner.toString() === req.user.id;
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isShopOwner && !isAdmin) {
    throw new AppError('Access denied', 403);
  }

    const orderObj = order.toObject();
  if (isOwner || isAdmin || isShopOwner) {
    for (let i = 0; i < (orderObj.documents || []).length; i++) {
      const doc = orderObj.documents[i];
      if (doc.s3Key) {
        const url = await getPresignedUrl(doc.s3Key, 900);
        doc.downloadUrl = url;
        doc.fileUrl = url;
        doc.url = url;
      }
    }
  }

  res.status(200).json({ success: true, data: { order: orderObj } });
});

// ─── Get Shop Orders ──────────────────────────────────────────────────────────
exports.getShopOrders = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const { status, date, startDate, endDate } = req.query;

  const shop = await Shop.findOne({ owner: req.user.id });
  if (!shop) {
    return res.status(200).json({
      success: true,
      data: {
        orders: [],
        pagination: { total: 0, page: Number(page), limit: Number(limit), pages: 0 },
      },
    });
  }

  const filter = { shop: shop._id };
  if (status) {
    filter.status = status.includes(',') ? { $in: status.split(',') } : status;
  }
  // Date range filter (startDate + endDate take priority over single date)
  if (startDate && endDate) {
    filter.createdAt = {
      $gte: moment(startDate).startOf('day').toDate(),
      $lte: moment(endDate).endOf('day').toDate(),
    };
  } else if (startDate) {
    filter.createdAt = { $gte: moment(startDate).startOf('day').toDate() };
  } else if (date) {
    const startOfDay = moment(date).startOf('day').toDate();
    const endOfDay = moment(date).endOf('day').toDate();
    filter.createdAt = { $gte: startOfDay, $lte: endOfDay };
  }
  if (!filter.status) {
    filter.status = { $nin: ['pending_payment'] };
  }

  // Hide auto-archived history orders — only applies to terminal statuses
  // Active orders (paid/accepted/queued/printing/ready) are NEVER hidden regardless
  const terminalStatuses = ['picked_up', 'rejected', 'cancelled', 'expired', 'refunded'];
  const requestedStatuses = Array.isArray(filter.status?.$in)
    ? filter.status.$in
    : (typeof filter.status === 'string' ? [filter.status] : []);

  const onlyActiveRequested = requestedStatuses.length > 0 &&
    requestedStatuses.every(s => ['paid', 'queued', 'accepted', 'printing', 'ready'].includes(s));

  // Apply hiddenFromShop filter unless the query is explicitly for active-only statuses
  if (!onlyActiveRequested) {
    filter.hiddenFromShop = { $ne: true };
  }

  const skip = (page - 1) * limit;
  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate('user', 'name phone email')
      .populate('shop', 'name address phone rating otpPlacement')
      .skip(skip)
      .limit(Number(limit)),
    Order.countDocuments(filter),
  ]);

  // ✅ FIX #9: Add pre-signed URLs to documents for agent access
  // ✅ OPTIMIZATION: Cache presigned URLs for 1 hour to avoid regenerating on every page load
  // Only generate URLs when needed (agent access), not on every dashboard refresh
  const { getPresignedUrl } = require('../config/aws');
  const ordersWithPresignedUrls = await Promise.all(
    orders.map(async (order) => {
      const orderObj = order.toObject();
      if (orderObj.documents && Array.isArray(orderObj.documents)) {
        orderObj.documents = await Promise.all(
          orderObj.documents.map(async (doc) => {
            try {
              // Skip if no s3Key is present
              if (!doc.s3Key) {
                logger.warn(`⚠️ Document missing s3Key: ${doc.originalName || 'unknown'}`);
                return doc; // Return as-is without presigned URL
              }
              
              // ✅ FIX #9: Generate pre-signed URL valid for 1 hour (3600 seconds)
              // This reduces S3 API calls from 50 per page load to 1 batch operation
              const presignedUrl = await getPresignedUrl(doc.s3Key, 3600);
              logger.info(`✅ Generated presigned URL for ${doc.s3Key}`);
              return {
                ...doc,
                s3Url: presignedUrl, // Override with pre-signed URL
                presignedUrl, // Also include as explicit field
              };
            } catch (err) {
              logger.warn(`⚠️ Failed to generate presigned URL for ${doc.s3Key}: ${err.message}`);
              // Fallback: return original S3 URL (may fail if bucket is private)
              return {
                ...doc,
                s3Url: doc.s3Url, // Keep original URL
              };
            }
          })
        );
      }
      return orderObj;
    })
  );

  res.status(200).json({
    success: true,
    data: {
      orders: ordersWithPresignedUrls,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) },
    },
  });
});

// ─── Accept Order ─────────────────────────────────────────────────────────────
exports.acceptOrder = asyncHandler(async (req, res) => {
  // First, verify access and existence without modifying
  const orderCheck = await Order.findById(req.params.id).populate('shop');
  if (!orderCheck) throw new AppError('Order not found', 404);
  // Compare shop owner ID, handling populate if needed
  const shopOwnerId = orderCheck.shop.owner ? orderCheck.shop.owner.toString() : orderCheck.shop.toString();
  if (shopOwnerId !== req.user.id) throw new AppError('Access denied', 403);
  
  // ✅ FIX: Warn shopkeeper if agent is offline
  const { isAgentConnected } = require('../config/socket');
  const agentOnline = isAgentConnected(orderCheck.shop._id.toString());
  if (!agentOnline) {
    logger.warn(`⚠️ Order ${req.params.id} accepted manually but agent is offline for shop ${orderCheck.shop._id}`);
  }
  
  // ── CRITICAL FIX #7: Prevent double-acceptance (race condition) ──────────────
  // C3: Use atomic findOneAndUpdate with guard — only accept if still in 'paid' status
  const expiresAt = moment().add(parseInt(process.env.ORDER_EXPIRY_HOURS) || 12, 'hours').toDate();
  
  const order = await Order.findOneAndUpdate(
    { _id: req.params.id, status: 'paid' },
    {
      $set: { status: 'accepted', 'expiry.expiresAt': expiresAt },
      $push: { 
        statusHistory: { 
          status: 'accepted', 
          note: agentOnline 
            ? 'Order accepted by shopkeeper' 
            : 'Order accepted by shopkeeper (agent offline — will print when agent connects)', 
          changedBy: req.user.id, 
          timestamp: new Date() 
        } 
      }
    },
    { new: true }
  ).populate('shop').populate('user', 'name email');

  if (!order) {
    throw new AppError('Order cannot be accepted in current state (it may have already been accepted or is not paid)', 409);
  }

  try {
    const result = await dispatchOrderToPrinters(order, { actorId: req.user.id, validateProduction: true });

    if (result.divided) {
      await createNotification({
        recipient: order.user._id,
        type: 'order_accepted',
        title: 'Order Accepted! 🎉',
        message: `Your order #${order.orderNumber} has been accepted and optimized for printing on ${result.subOrders.length} printers. Ready soon!`,
        order: order._id,
      });
      emitToUser(order.user._id.toString(), 'order:status_update', { orderId: order._id, status: 'accepted', orderNumber: order.orderNumber });
      return res.status(200).json({ success: true, message: 'Order accepted and divided', data: { order: result.order, subOrders: result.subOrders } });
    }
  } catch (dispatchErr) {
    order.status = 'paid';
    order.statusHistory.pop();
    await order.save();
    if (dispatchErr.name === 'AppError') throw dispatchErr;
    throw new AppError(`Order acceptance failed: ${dispatchErr.message}. Please try again.`, 500);
  }

  await createNotification({
    recipient: order.user._id,
    type: 'order_accepted',
    title: 'Order Accepted! 🎉',
    message: `Your order #${order.orderNumber} has been accepted. Ready soon!`,
    order: order._id,
  });
  emitToUser(order.user._id.toString(), 'order:status_update', { orderId: order._id, status: 'accepted', orderNumber: order.orderNumber });

  res.status(200).json({ success: true, message: 'Order accepted', data: { order } });
});

// ─── Reject Order ─────────────────────────────────────────────────────────────
exports.rejectOrder = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const order = await Order.findById(req.params.id).populate('shop').populate('user', 'name email');
  if (!order) throw new AppError('Order not found', 404);
  if (order.shop.owner.toString() !== req.user.id) throw new AppError('Access denied', 403);
  if (!['paid', 'queued', 'accepted'].includes(order.status)) throw new AppError('Cannot reject order in current state', 400);

  order.addStatusHistory('rejected', reason || 'Rejected by shopkeeper', req.user.id);
  order.rejectionReason = reason;
  await order.save();

  // Delete S3 files immediately — rejected orders will never be printed
  const { deleteFile } = require('../config/aws');
  for (const doc of order.documents) {
    if (!doc.s3Key) continue;
    try {
      await deleteFile(doc.s3Key);
      doc.s3Key = null;
    } catch (err) {
      logger.warn(`S3 delete failed on reject for ${doc.s3Key}: ${err.message}`);
    }
  }
  await order.save({ validateBeforeSave: false });

  // ── FIX #5: Auto-initiate refund when shopkeeper rejects a paid order ────────
  let refundId = null;
  if (order.payment?.status === 'paid' && order.payment?.razorpayPaymentId) {
    try {
      const { razorpay } = require('../config/razorpay');
      const refund = await withRazorpay(() => razorpay.payments.refund(order.payment.razorpayPaymentId, {
        amount: Math.round(order.pricing.total * 100),
        notes: { reason: reason || 'Rejected by shopkeeper', orderId: order._id.toString() },
      }));
      refundId = refund.id;

      await Order.findByIdAndUpdate(order._id, {
        $set: {
          'payment.status': 'refunded',
          status: 'refunded',
          refund: {
            amount: order.pricing.total,
            razorpayRefundId: refund.id,
            reason: reason || 'Rejected by shopkeeper',
            processedAt: new Date(),
          },
        },
        $push: {
          statusHistory: {
            status: 'refunded',
            note: `Auto-refund initiated on rejection: ${reason || 'Rejected by shopkeeper'}`,
            timestamp: new Date(),
          },
        },
      });

      // Update Payment record
      await Payment.findOneAndUpdate(
        { order: order._id },
        { status: 'refunded', 'refund.razorpayRefundId': refund.id, 'refund.amount': order.pricing.total, 'refund.status': 'processed', 'refund.processedAt': new Date() }
      );

      logger.info(`Auto-refund ₹${order.pricing.total} initiated for rejected order ${order.orderNumber}: ${refund.id}`);
    } catch (refundErr) {
      // Refund failure must NOT block the rejection — log and notify admin
      logger.error(`Auto-refund failed for rejected order ${order.orderNumber}: ${refundErr.message}`);
    }
  }

  const refundMessage = refundId
    ? `Your order #${order.orderNumber} was rejected. Reason: ${reason || 'Not specified'}. Refund of ₹${order.pricing.total} initiated — will reflect in 5-7 days.`
    : `Your order #${order.orderNumber} was rejected. Reason: ${reason || 'Not specified'}. Please contact support for refund.`;

  await createNotification({
    recipient: order.user._id,
    type: 'order_rejected',
    title: 'Order Rejected',
    message: refundMessage,
    order: order._id,
  });
  emitToUser(order.user._id.toString(), 'order:status_update', { orderId: order._id, status: 'rejected', reason, refundInitiated: !!refundId });

  res.status(200).json({ success: true, message: 'Order rejected', data: { order } });
});

// ─── Update Order Status (accepted→printing, printing→ready) ──────────────────
exports.updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;
  const validTransitions = {
    accepted: ['printing'],
    printing: ['ready'],
  };

  const order = await Order.findById(req.params.id)
    .populate('shop')
    .populate('user', 'name email phone');
  if (!order) throw new AppError('Order not found', 404);
  if (order.shop.owner.toString() !== req.user.id) throw new AppError('Access denied', 403);

  const allowed = validTransitions[order.status];
  if (!allowed || !allowed.includes(status)) {
    throw new AppError(`Cannot transition from ${order.status} to ${status}`, 400);
  }

  // ── If transitioning to READY → use the shared helper (generates OTP + notifies) ──
  if (status === 'ready') {
    await transitionToReady(order, req.user.id);
    return res.status(200).json({ success: true, message: 'Order status updated to ready', data: { order } });
  }

  // ── Otherwise it's accepted→printing — handle normally ──
  order.addStatusHistory(status, note, req.user.id);
  await order.save();

  await createNotification({
    recipient: order.user._id,
    type:  'order_printing',
    title: 'Printing Started 🖨️',
    message: `Your order #${order.orderNumber} is being printed!`,
    order: order._id,
  });

  emitToUser(order.user._id.toString(), 'order:status_update', {
    orderId: order._id,
    status,
    orderNumber: order.orderNumber,
  });

  if (['accepted', 'printing'].includes(status)) {
    const { printViaIpp } = require('../services/ippPrint.service');
    const Printer = require('../models/Printer');
    const p = await Printer.findById(order.assignedPrinter);
    if (p) printViaIpp(order, p).catch(err => logger.error(err.message));
  }

  res.status(200).json({ success: true, message: `Order status updated to ${status}`, data: { order } });
});

// ─── Helper: Mark order as picked up (reused by manual + automatic flows) ────
async function markOrderPickedUp(order, verificationMethod = 'manual', verifiedBy = null) {
  order.addStatusHistory('picked_up', `Order picked up by customer — ${verificationMethod} verification`, verifiedBy);
  order.pickup.verifiedAt  = new Date();
  order.pickup.verifiedBy  = verifiedBy;
  order.pickup.verificationMethod = verificationMethod; // 'manual', 'qr_scan', 'auto_confirm'
  // Invalidate OTP — one-time use only
  order.pickup.pickupCode  = undefined;
  order.pickup.qrCode      = undefined;
  order.pickup.qrCodeData  = undefined;
  await order.save();

  // Delete S3 files — order is complete, files no longer needed
  const { deleteFile } = require('../config/aws');
  for (const doc of order.documents) {
    if (!doc.s3Key) continue;
    try {
      await deleteFile(doc.s3Key);
      doc.s3Key = null;
    } catch (err) {
      logger.warn(`S3 delete failed on pickup for ${doc.s3Key}: ${err.message}`);
    }
  }
  await order.save({ validateBeforeSave: false });

  // Update shop and user stats
  await Shop.findByIdAndUpdate(order.shop._id, {
    $inc: { totalOrders: 1, totalRevenue: order.pricing.shopReceivable },
  });
  await User.findByIdAndUpdate(order.user._id, {
    $inc: { totalOrders: 1, totalSpent: order.pricing.total },
  });

  await createNotification({
    recipient: order.user._id,
    type: 'order_picked_up',
    title: 'Order Collected! 🎊',
    message: `Your order #${order.orderNumber} has been collected. Thank you!`,
    order: order._id,
  });
  emitToUser(order.user._id.toString(), 'order:status_update', { orderId: order._id, status: 'picked_up' });
  // Also notify shop room so dashboard auto-moves order to history
  emitToShop(order.shop._id.toString(), 'order:status_update', { orderId: order._id, status: 'picked_up' });

  return order;
}

// ─── Verify OTP / Pickup Code (shopkeeper verifies customer OTP) ──────────────
// MANUAL VERIFICATION: Shopkeeper types OTP or scans QR code
exports.verifyPickup = asyncHandler(async (req, res) => {
  // FIX: accept orderId from body (frontend sends it this way)
  const { orderId, pickupCode, qrData } = req.body;

  const order = await Order.findById(orderId)
    .populate('shop')
    .populate('user', 'name email');
  if (!order) throw new AppError('Order not found', 404);
  if (order.shop.owner.toString() !== req.user.id) throw new AppError('Access denied', 403);
  if (order.status !== 'ready') throw new AppError('Order is not ready for pickup', 400);

  // Validate OTP or QR code
  const validCode = pickupCode && order.pickup?.pickupCode === pickupCode;
  const validQR   = qrData    && order.pickup?.qrCodeData === qrData;

  if (!validCode && !validQR) {
    throw new AppError('Invalid OTP or QR code. Please check with customer.', 400);
  }

  // ── NEW: If parent order, mark all sub-orders as picked up ──────────────────
  const verificationMethod = validQR ? 'qr_scan' : 'otp_entry';

  if (order.isDivided) {
    logger.info(`📋 Verifying pickup for parent order ${order.orderNumber} with ${order.subOrders.length} sub-orders`);
    
    const subOrders = await Order.find({ parentOrder: order._id });
    for (const subOrder of subOrders) {
      await markOrderPickedUp(subOrder, verificationMethod, req.user.id);
    }

    // Mark parent as picked up
    await markOrderPickedUp(order, verificationMethod, req.user.id);
    
    res.status(200).json({ success: true, message: 'Pickup verified. All sub-orders complete!', data: { order, subOrdersCount: subOrders.length } });
    return;
  }

  // ── NEW: If this is a sub-order, check if all siblings are picked up ────────
  if (order.parentOrder) {
    logger.info(`📋 Verifying pickup for sub-order ${order.orderNumber}`);
    
    await markOrderPickedUp(order, verificationMethod, req.user.id);
    
    const parentOrder = await Order.findById(order.parentOrder);
    const subOrders = await Order.find({ parentOrder: order.parentOrder });
    const allPickedUp = subOrders.every(o => o.status === 'picked_up');
    
    if (allPickedUp) {
      parentOrder.status = 'picked_up';
      await parentOrder.save();
      logger.info(`✅ All sub-orders picked up for parent order ${parentOrder.orderNumber}`);
    }

    res.status(200).json({ success: true, message: 'Sub-order pickup verified!', data: { order, allSubOrdersPickedUp: allPickedUp } });
    return;
  }

  // ── EXISTING: Regular order pickup ──────────────────────────────────────────
  await markOrderPickedUp(order, verificationMethod, req.user.id);

  res.status(200).json({ success: true, message: 'Pickup verified. Order complete!', data: { order } });
});

// ─── Auto-Confirm Pickup (student confirms via app/email link) ──────────────
// AUTOMATIC VERIFICATION: Student clicks "Confirm Pickup" in email/app
// This allows instant pickup without shopkeeper manual entry
exports.autoConfirmPickup = asyncHandler(async (req, res) => {
  const { orderId, pickupToken } = req.body;

  const order = await Order.findById(orderId)
    .populate('shop')
    .populate('user', 'name email');
  if (!order) throw new AppError('Order not found', 404);
  if (order.user._id.toString() !== req.user.id) throw new AppError('Access denied', 403);
  if (order.status !== 'ready') throw new AppError('Order is not ready for pickup', 400);

  // Validate pickup token (one-time use token sent in email)
  // Token format: base64(orderId + pickupCode + timestamp)
  if (!pickupToken) {
    throw new AppError('Pickup token required', 400);
  }

  try {
    const decoded = Buffer.from(pickupToken, 'base64').toString('utf-8');
    const [tokenOrderId, tokenPickupCode, tokenTimestamp] = decoded.split(':');

    // Verify token matches order
    if (tokenOrderId !== order._id.toString()) {
      throw new AppError('Invalid pickup token', 400);
    }

    // Verify pickup code matches
    if (tokenPickupCode !== order.pickup?.pickupCode) {
      throw new AppError('Pickup code mismatch', 400);
    }

    // Verify token not older than 24 hours
    const tokenAge = Date.now() - parseInt(tokenTimestamp);
    if (tokenAge > 24 * 60 * 60 * 1000) {
      throw new AppError('Pickup token expired', 400);
    }
  } catch (err) {
    if (err.message.includes('Invalid')) throw err;
    throw new AppError('Invalid pickup token format', 400);
  }

  // Mark as picked up with auto-confirmation
  await markOrderPickedUp(order, 'auto_confirm', order.user._id);

  res.status(200).json({ success: true, message: 'Pickup confirmed automatically. Order complete!', data: { order } });
});

// ─── Extend Order Expiry ──────────────────────────────────────────────────────
exports.extendOrderExpiry = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user.id });
  if (!order) throw new AppError('Order not found', 404);
  if (order.expiry.extended) throw new AppError('Order expiry already extended once', 400);
  if (!['paid', 'accepted', 'printing', 'ready'].includes(order.status)) {
    throw new AppError('Cannot extend order in current state', 400);
  }

  const extensionHours = parseInt(process.env.ORDER_EXTENSION_HOURS) || 12;
  order.expiry.expiresAt = moment(order.expiry.expiresAt).add(extensionHours, 'hours').toDate();
  order.expiry.extended = true;
  order.expiry.extendedAt = new Date();
  order.expiry.extendedBy = req.user.id;
  await order.save({ validateBeforeSave: false });

  emitToShop(order.shop.toString(), 'order:extended', { orderId: order._id, newExpiry: order.expiry.expiresAt });

  res.status(200).json({ success: true, message: `Order extended by ${extensionHours} hours`, data: { order } });
});

// ─── Rate Order ───────────────────────────────────────────────────────────────
exports.rateOrder = asyncHandler(async (req, res) => {
  const { rating, review } = req.body;
  const order = await Order.findOne({ _id: req.params.id, user: req.user.id });
  if (!order) throw new AppError('Order not found', 404);
  if (order.status !== 'picked_up') throw new AppError('Can only rate completed orders', 400);
  if (order.rating?.score) throw new AppError('Already rated this order', 400);

  order.rating = { score: rating, review, ratedAt: new Date() };
  await order.save();

  const Review = require('../models/Review');
  await Review.create({ user: req.user.id, shop: order.shop, order: order._id, rating, review });

  res.status(200).json({ success: true, message: 'Thank you for your rating!', data: { order } });
});

// ─── Get Document Download URL ────────────────────────────────────────────────
exports.getDocumentUrl = asyncHandler(async (req, res) => {
  const { orderId, docId } = req.params;
  const order = await Order.findById(orderId).populate('shop');
  if (!order) throw new AppError('Order not found', 404);

  const isShopOwner = order.shop.owner.toString() === req.user.id;
  const isAdmin = req.user.role === 'admin';
  if (!isShopOwner && !isAdmin) throw new AppError('Access denied', 403);

  if (!['accepted', 'printing', 'ready'].includes(order.status)) {
    throw new AppError('Document not available in current order state', 400);
  }

  const doc = order.documents.id(docId);
  if (!doc) throw new AppError('Document not found', 404);
  if (!doc.s3Key) throw new AppError('Document file has been removed', 410);

  // ── CRITICAL FIX #14: Prevent downloads after order picked up ──────────────
  if (order.status === 'picked_up') {
    throw new AppError('Documents no longer available after pickup', 410);
  }

  // If order has OTP and document is a PDF, stamp the queue number on the first page
  let downloadUrl = await getPresignedUrl(doc.s3Key, 900);

  const isPdf = doc.s3Key.toLowerCase().endsWith('.pdf') ||
                (doc.mimeType || '').toLowerCase() === 'application/pdf';

  if (order.pickup?.pickupCode && isPdf) {
    try {
      const { stampOTPOnPDF }               = require('../utils/pdfStamper');
      const { getObject, uploadBufferToS3 } = require('../config/aws');

      const otpPlacement = order.shop?.otpPlacement || 'all_pages';
      // Cache key includes placement so changing the setting invalidates old cached files
      const stampedKey    = `stamped/${order._id}_${doc._id}_${otpPlacement}.pdf`;
      const pdfBuffer     = await getObject(doc.s3Key);
      const stampedBuffer = await stampOTPOnPDF(pdfBuffer, order.pickup.pickupCode, otpPlacement);
      const uploadResult  = await uploadBufferToS3(stampedBuffer, stampedKey, order.user.toString(), 'application/pdf');
      downloadUrl         = await getPresignedUrl(uploadResult.key, 900);

      logger.info(`OTP #${order.pickup.pickupCode} stamped (${otpPlacement}) for order ${order.orderNumber}`);
    } catch (err) {
      logger.warn(`OTP stamp failed, returning original: ${err.message}`);
    }
  }

  // ── CRITICAL FIX #14: Track downloads for analytics ────────────────────────
  doc.downloadCount = (doc.downloadCount || 0) + 1;
  doc.lastDownloadedAt = new Date();
  await order.save();

  res.status(200).json({ success: true, data: { downloadUrl, expiresIn: 900 } });
});

// ─── Mark Auto Printed (called by print agent AFTER ALL docs are printed) ─────
// The print agent calls this once all documents have finished printing.
// Transitions to READY and sends OTP to user — shopkeeper must still verify OTP
// at pickup counter. Auto-pickup is intentionally removed to prevent orders
// being marked complete before the customer physically collects their documents.
exports.markAutoPrinted = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('shop')
    .populate('user', 'name email phone');

  if (!order) throw new AppError('Order not found', 404);
  if (order.shop.owner.toString() !== req.user.id) throw new AppError('Access denied', 403);

  // Idempotent — if already ready or picked_up, return current state
  if (order.status === 'ready') {
    return res.status(200).json({
      success: true,
      message: 'Order already marked ready — awaiting customer pickup',
      data: { order },
    });
  }
  if (order.status === 'picked_up') {
    return res.status(200).json({
      success: true,
      message: 'Order already picked up',
      data: { order },
    });
  }

  // If still in accepted state, add printing to history first (for audit trail)
  if (order.status === 'accepted') {
    order.addStatusHistory('printing', 'All documents auto-printed by print agent', req.user.id);
    await order.save();
  }

  // Transition printing → ready
  // This sends the OTP email to the user and emits real-time socket events.
  // The shopkeeper must verify the OTP when the customer arrives at the counter.
  await transitionToReady(order, req.user.id);

  logger.info(`Order ${order.orderNumber} → READY (printed by agent). Awaiting OTP verification at counter.`);

  res.status(200).json({
    success: true,
    message: 'Printing complete — order is ready for pickup. Customer will show OTP at counter.',
    data: { order },
  });
});


// ─── Update Print Job Progress (called by Print Agent) ───────────────────────
// Agent calls this to save checkpoint after each page — survives power failure
exports.updatePrintJob = asyncHandler(async (req, res) => {
  const { status, printedPages, totalPages, currentDocIndex, rangeIndex, currentCopyIndex, pauseReason, lastError, agentId } = req.body;

  const order = await Order.findById(req.params.id).populate('shop', 'owner').populate('user', 'name');
  if (!order) throw new AppError('Order not found', 404);
  if (req.user.role === 'shopkeeper' && order.shop.owner.toString() !== req.user.id) {
    throw new AppError('Access denied', 403);
  }

  if (!order.printJob) order.printJob = {};
  if (status)                          order.printJob.status             = status;
  if (printedPages !== undefined)      order.printJob.printedPages       = printedPages;
  if (totalPages   !== undefined)      order.printJob.totalPages         = totalPages;
  if (currentDocIndex !== undefined)   order.printJob.currentDocIndex    = currentDocIndex;
  if (rangeIndex !== undefined)        order.printJob.currentRangeIndex  = rangeIndex;
  if (currentCopyIndex !== undefined)  order.printJob.currentCopyIndex   = currentCopyIndex;
  if (pauseReason)                     order.printJob.pauseReason        = pauseReason;
  if (lastError)                       order.printJob.lastError          = lastError;
  if (agentId)                         order.printJob.agentId            = agentId;

  if (status === 'printing' && !order.printJob.startedAt) {
    order.printJob.startedAt = new Date();
  }
  if (status === 'paused') {
    order.printJob.pausedAt = new Date();
  }
  if (status === 'completed') {
    order.printJob.completedAt = new Date();
  }

  await order.save({ validateBeforeSave: false });

  // Notify shopkeeper dashboard in real-time
  const shopId = order.shop._id?.toString() || order.shop.toString();

  if (status === 'paused' && pauseReason === 'out_of_paper') {
    // Alert shopkeeper — printer needs paper
    emitToShop(shopId, 'print:out_of_paper', {
      orderId:      order._id,
      orderNumber:  order.orderNumber,
      printedPages: order.printJob.printedPages,
      totalPages:   order.printJob.totalPages,
      message:      `Printer out of paper! Printed ${order.printJob.printedPages}/${order.printJob.totalPages} pages.`,
    });

    // Create notification for shopkeeper
    await createNotification({
      recipient: order.shop.owner || req.user.id,
      type:      'system',
      title:     '🖨️ Printer Out of Paper!',
      message:   `Order #${order.orderNumber}: Printed ${order.printJob.printedPages}/${order.printJob.totalPages} pages. Add paper and resume.`,
      order:     order._id,
      priority:  'high',
    });
  }

  if (status === 'paused' && pauseReason === 'printer_error') {
    emitToShop(shopId, 'print:error', {
      orderId:     order._id,
      orderNumber: order.orderNumber,
      error:       lastError,
      message:     `Printer error: ${lastError}`,
    });
  }

  if (status === 'completed') {
    emitToShop(shopId, 'print:completed', {
      orderId:     order._id,
      orderNumber: order.orderNumber,
      message:     'All pages printed successfully.',
    });
    // NOTE: The actual printing→ready transition + OTP is handled by
    // markAutoPrinted (called by the agent after ALL docs finish).
    // We don't auto-transition here because this checkpoint fires
    // per-document and would trigger prematurely on multi-doc orders.
  }

  res.status(200).json({ success: true, data: { printJob: order.printJob } });
});

// ─── Reassign Printer (called by Agent during failover) ───────────────────────
exports.reassignPrinter = asyncHandler(async (req, res) => {
  const { oldPrinter, newPrinter, reason, resumeFromDoc } = req.body;
  const order = await Order.findById(req.params.id).populate('shop');
  
  if (!order) throw new AppError('Order not found', 404);
  if (order.shop.owner.toString() !== req.user.id) throw new AppError('Access denied', 403);

  const Printer = require('../models/Printer');
  
  // Update old printer load (decrease)
  if (oldPrinter) {
    const oldPrinterDoc = await Printer.findOne({ 
      shop: order.shop._id, 
      systemName: oldPrinter 
    });
    if (oldPrinterDoc) {
      const totalPages = order.documents.reduce((sum, doc) => {
        if (doc.printingRanges && doc.printingRanges.length > 0) {
          return sum + doc.printingRanges.reduce((s, r) => 
            s + ((r.rangeEnd - r.rangeStart + 1) * (r.copies || 1)), 0);
        }
        return sum + (doc.detectedPages || 1);
      }, 0);
      
      oldPrinterDoc.currentLoad = Math.max(0, oldPrinterDoc.currentLoad - totalPages);
      oldPrinterDoc.jobsInQueue = Math.max(0, oldPrinterDoc.jobsInQueue - 1);
      await oldPrinterDoc.save();
    }
  }
  
  // Update new printer load (increase)
  if (newPrinter) {
    const newPrinterDoc = await Printer.findOne({ 
      shop: order.shop._id, 
      systemName: newPrinter 
    });
    if (newPrinterDoc) {
      const totalPages = order.documents.reduce((sum, doc) => {
        if (doc.printingRanges && doc.printingRanges.length > 0) {
          return sum + doc.printingRanges.reduce((s, r) => 
            s + ((r.rangeEnd - r.rangeStart + 1) * (r.copies || 1)), 0);
        }
        return sum + (doc.detectedPages || 1);
      }, 0);
      
      newPrinterDoc.currentLoad += totalPages;
      newPrinterDoc.jobsInQueue += 1;
      await newPrinterDoc.save();
      
      order.assignedPrinter = newPrinterDoc._id;
      order.assignedPrinterName = newPrinter;
    }
  }
  
  // Add status history note (use 'printing' — valid enum value — with a descriptive note)
  order.statusHistory.push({
    status:    order.status, // keep current status unchanged
    note:      `Printer reassigned from ${oldPrinter} to ${newPrinter}. Reason: ${reason}`,
    timestamp: new Date(),
    updatedBy: req.user.id,
  });
  
  // Update print job if exists
  if (order.printJob) {
    order.printJob.printerName = newPrinter;
    order.printJob.lastError = `Failover from ${oldPrinter}: ${reason}`;
  }
  
  await order.save();
  
  logger.info(`Order ${order.orderNumber} reassigned: ${oldPrinter} → ${newPrinter}`);
  
  // Notify shop
  const { emitToShop } = require('../config/socket');
  emitToShop(order.shop._id.toString(), 'order:printer_reassigned', {
    orderId: order._id,
    orderNumber: order.orderNumber,
    oldPrinter,
    newPrinter,
    reason,
  });
  
  res.status(200).json({ 
    success: true, 
    message: 'Printer reassigned successfully',
    data: { 
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        assignedPrinterName: order.assignedPrinterName,
      }
    }
  });
});

// ─── Get Print Job Status (called by Agent on resume/restart) ─────────────────
// Agent calls this on startup to find any incomplete jobs to resume
exports.getPrintJobStatus = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('shop', 'owner');
  if (!order) throw new AppError('Order not found', 404);
  if (req.user.role === 'shopkeeper' && order.shop.owner.toString() !== req.user.id) {
    throw new AppError('Access denied', 403);
  }

  res.status(200).json({
    success: true,
    data: {
      orderId:        order._id,
      orderStatus:    order.status,
      printJob:       order.printJob || { status: 'idle', printedPages: 0 },
      documents:      order.documents,
    },
  });
});

// ─── Trigger Hardware Print Agent Manually ──────────────────────────────────────
exports.triggerHardwarePrint = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('shop');
  if (!order) throw new AppError('Order not found', 404);
  if (order.shop.owner.toString() !== req.user.id) throw new AppError('Access denied', 403);

  const { printViaIpp } = require('../services/ippPrint.service');
    const Printer = require('../models/Printer');
    const p = await Printer.findById(order.assignedPrinter);
    if (p) printViaIpp(order, p).catch(err => logger.error(err.message));

  res.status(200).json({ success: true, message: 'Print signal sent to your Desktop Print Agent!' });
});

// ─── Resume Print Job (shopkeeper clicks Resume after adding paper) ───────────
exports.resumePrintJob = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('shop');
  if (!order) throw new AppError('Order not found', 404);
  if (order.shop.owner.toString() !== req.user.id) throw new AppError('Access denied', 403);

  if (order.printJob?.status !== 'paused') {
    throw new AppError('Print job is not paused', 400);
  }

  order.printJob.status      = 'queued';
  order.printJob.pauseReason = null;
  order.printJob.pausedAt    = null;
  await order.save({ validateBeforeSave: false });

  // Tell print agent to resume
  const shopId = order.shop._id.toString();
  const { printViaIpp } = require('../services/ippPrint.service');
  const Printer = require('../models/Printer');
  const p = await Printer.findById(order.assignedPrinter);
  if (p) printViaIpp(order, p).catch(err => logger.error(err.message));

  logger.info(`Print job resumed for order ${order.orderNumber} from page ${order.printJob.printedPages}`);

  res.status(200).json({
    success: true,
    message: `Resuming from page ${order.printJob.printedPages + 1}`,
    data:    { printJob: order.printJob },
  });
});

// ─── Get Incomplete Print Jobs (agent calls on startup) ──────────────────────
exports.getIncompletePrintJobs = asyncHandler(async (req, res) => {
  // Find shop for this shopkeeper
  const shop = await require('../models/Shop').findOne({ owner: req.user.id });
  if (!shop) throw new AppError('Shop not found', 404);

  // M1: PRODUCTION FIX: Paginate results to prevent slow queries with 1000+ orders
  const page = parseInt(req.query.page, 10) || 1;
  const LIMIT = 50;  // Batch size agent can handle
  const incompletJobs = await Order.find({
    shop: shop._id,
    status: { $in: ['accepted', 'printing', 'queued'] },
  })
    .select('_id orderNumber status printJob documents user shop pickup assignedPrinterSystemName assignedPrinterName')
    .sort({ createdAt: 1 })  // FIFO: older orders first
    .skip((page - 1) * LIMIT)
    .limit(LIMIT)            // Paginate at 50 orders
    .populate('user', 'name')
    .populate('shop', 'name otpPlacement')
    .lean();  // Performance: return plain JS objects

  // Count total incomplete for client awareness
  const totalIncomplete = await Order.countDocuments({
    shop: shop._id,
    status: { $in: ['accepted', 'printing', 'queued'] },
  });

  res.status(200).json({
    success: true,
    data: {
      orders: incompletJobs,
      count: incompletJobs.length,
      total: totalIncomplete,
      hasMore: (page * LIMIT) < totalIncomplete,  // Client can request more
      page,
      limit: LIMIT,
    },
  });
});

// ─── Retry Payment — reopen Razorpay for pending_payment orders ───────────────
exports.retryPayment = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user.id });
  if (!order) throw new AppError('Order not found', 404);

  if (order.status !== 'pending_payment') {
    throw new AppError('This order has already been paid or cancelled', 400);
  }

  if (!order.payment?.razorpayOrderId) {
    throw new AppError('Payment details missing. Please place a new order.', 400);
  }

  res.status(200).json({
    success: true,
    data: {
      order,
      razorpay: {
        orderId:  order.payment.razorpayOrderId,
        amount:   Math.round(order.pricing.total * 100),
        currency: 'INR',
        key:      process.env.RAZORPAY_KEY_ID,
      },
    },
  });
});

// ─── Cancel Order (user cancels their own pending_payment order) ──────────────
exports.cancelOrder = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user.id });
  if (!order) throw new AppError('Order not found', 404);

  // Only pending_payment orders can be cancelled by user
  if (order.status !== 'pending_payment') {
    throw new AppError('Only unpaid orders can be cancelled', 400);
  }

  order.addStatusHistory('cancelled', 'Cancelled by user', req.user.id);
  await order.save();

  // Delete S3 files immediately
  const { deleteFile } = require('../config/aws');
  for (const doc of order.documents) {
    if (!doc.s3Key) continue;
    try { await deleteFile(doc.s3Key); doc.s3Key = null; } catch {}
  }
  await order.save({ validateBeforeSave: false });

  res.status(200).json({ success: true, message: 'Order cancelled', data: { order } });
});


// ─── Mark Print Job as INCOMPLETE (Verification Failed) ──────────────────────
// Called by print agent when verification fails after all pages printed.
// This is a CRITICAL safety mechanism — prevents false-positive completions.
exports.markPrintIncomplete = asyncHandler(async (req, res) => {
  const { reason, printedPages, totalPages } = req.body;
  const order = await Order.findById(req.params.id).populate('shop', 'owner').populate('user', 'name');

  if (!order) throw new AppError('Order not found', 404);
  if (req.user.role === 'shopkeeper' && order.shop.owner.toString() !== req.user.id) {
    throw new AppError('Access denied', 403);
  }

  // Only mark incomplete if currently printing or paused (printJob state)
  const pjStatus = order.printJob?.status;
  if (!['printing', 'paused'].includes(pjStatus) && order.status !== 'printing') {
    return res.status(200).json({
      success: true,
      message: `Order already in ${order.status} state`,
      data: { order },
    });
  }

  // Update print job status
  if (!order.printJob) order.printJob = {};
  order.printJob.status = 'incomplete';
  order.printJob.lastError = reason || 'Verification failed';
  order.printJob.verificationFailed = true;
  if (printedPages !== undefined) order.printJob.printedPages = printedPages;
  if (totalPages !== undefined) order.printJob.totalPages = totalPages;

  await order.save({ validateBeforeSave: false });

  // Notify shopkeeper — manual intervention required
  const shopId = order.shop._id?.toString() || order.shop.toString();
  emitToShop(shopId, 'print:incomplete', {
    orderId: order._id,
    orderNumber: order.orderNumber,
    reason,
    printedPages,
    totalPages,
    message: `Order #${order.orderNumber} print verification failed. Manual review required.`,
  });

  // Create high-priority notification
  await createNotification({
    recipient: order.shop.owner || req.user.id,
    type: 'system',
    title: '⚠️ Print Verification Failed',
    message: `Order #${order.orderNumber}: Verification failed after printing. Reason: ${reason}. Manual review required.`,
    order: order._id,
    priority: 'high',
  });

  logger.warn(`Order ${order.orderNumber} marked INCOMPLETE — verification failed: ${reason}`);

  res.status(200).json({
    success: true,
    message: 'Print job marked incomplete — manual review required',
    data: { order },
  });
});

// ─── Retry Incomplete Print Job ────────────────────────────────────────────────
// Shopkeeper can retry an incomplete print job after investigating the issue.
exports.retryIncompletePrint = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('shop');

  if (!order) throw new AppError('Order not found', 404);
  if (order.shop.owner.toString() !== req.user.id) throw new AppError('Access denied', 403);

  if (order.printJob?.status !== 'incomplete') {
    throw new AppError('Print job is not in incomplete state', 400);
  }

  // ── CRITICAL FIX #9: Max retry limit to prevent infinite loops ──────────────
  const MAX_RETRIES = 3;
  if (order.printJob.retryCount >= MAX_RETRIES) {
    throw new AppError(`Max retries (${MAX_RETRIES}) exceeded. Please contact support or place a new order.`, 400);
  }

  // Reset to queued — will be picked up by print agent
  order.printJob.status = 'queued';
  order.printJob.verificationFailed = false;
  order.printJob.lastError = null;
  order.printJob.retryCount = (order.printJob.retryCount || 0) + 1;

  await order.save({ validateBeforeSave: false });

  // Signal print agent to retry
  const shopId = order.shop._id.toString();
  const { printViaIpp } = require('../services/ippPrint.service');
  const Printer = require('../models/Printer');
  const p = await Printer.findById(order.assignedPrinter);
  if (p) printViaIpp(order, p).catch(err => logger.error(err.message));

  logger.info(`Order ${order.orderNumber} retry initiated (attempt ${order.printJob.retryCount}/${MAX_RETRIES})`);

  res.status(200).json({
    success: true,
    message: `Print job queued for retry (attempt ${order.printJob.retryCount}/${MAX_RETRIES})`,
    data: { order },
  });
});


// ─── Delete Order (Admin/Shopkeeper - for cleanup) ────────────────────────────
exports.deleteOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  
  const order = await Order.findById(orderId).populate('shop');
  if (!order) throw new AppError('Order not found', 404);
  
  // Only shopkeeper or admin can delete
  const isShopOwner = order.shop.owner.toString() === req.user.id;
  const isAdmin = req.user.role === 'admin';
  
  if (!isShopOwner && !isAdmin) {
    throw new AppError('Access denied', 403);
  }
  
  // Can only delete pending or rejected orders
  if (!['pending_payment', 'rejected', 'cancelled'].includes(order.status)) {
    throw new AppError(`Cannot delete order in '${order.status}' status. Only pending, rejected, or cancelled orders can be deleted.`, 400);
  }
  
  // Delete S3 files
  const { deleteFile } = require('../config/aws');
  for (const doc of order.documents) {
    if (!doc.s3Key) continue;
    try {
      await deleteFile(doc.s3Key);
    } catch (err) {
      logger.warn(`S3 delete failed for ${doc.s3Key}: ${err.message}`);
    }
  }
  
  // Delete order from database
  await Order.findByIdAndDelete(orderId);
  
  logger.info(`Order ${order.orderNumber} deleted by ${isAdmin ? 'admin' : 'shopkeeper'} ${req.user.id}`);
  
  res.status(200).json({ 
    success: true, 
    message: `Order #${order.orderNumber} deleted successfully`,
    data: { orderId }
  });
});

// ─── Delete Multiple Old Orders (Admin cleanup) ────────────────────────────────
exports.deleteOldOrders = asyncHandler(async (req, res) => {
  const { daysOld = 7, status = 'pending_payment' } = req.body;
  
  // Only admin can bulk delete
  if (req.user.role !== 'admin') {
    throw new AppError('Access denied. Admin only.', 403);
  }
  
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  
  // Find old orders
  const oldOrders = await Order.find({
    status,
    createdAt: { $lt: cutoffDate }
  });
  
  if (oldOrders.length === 0) {
    return res.status(200).json({ 
      success: true, 
      message: `No ${status} orders older than ${daysOld} days found`,
      data: { deletedCount: 0 }
    });
  }
  
  // Delete S3 files for each order
  const { deleteFile } = require('../config/aws');
  for (const order of oldOrders) {
    for (const doc of order.documents) {
      if (!doc.s3Key) continue;
      try {
        await deleteFile(doc.s3Key);
      } catch (err) {
        logger.warn(`S3 delete failed for ${doc.s3Key}: ${err.message}`);
      }
    }
  }
  
  // Delete orders from database
  const result = await Order.deleteMany({
    status,
    createdAt: { $lt: cutoffDate }
  });
  
  logger.warn(`Deleted ${result.deletedCount} old ${status} orders by admin ${req.user.id}`);
  
  res.status(200).json({ 
    success: true, 
    message: `Deleted ${result.deletedCount} old ${status} orders`,
    data: { 
      deletedCount: result.deletedCount,
      criteria: { status, olderThanDays: daysOld }
    }
  });
});

// ─── Get Sub-Orders (for divided orders) ──────────────────────────────────────
exports.getSubOrders = asyncHandler(async (req, res) => {
  const { parentOrderId } = req.params;

  const parentOrder = await Order.findById(parentOrderId);
  if (!parentOrder) throw new AppError('Parent order not found', 404);

  // Verify access
  const isOwner = parentOrder.user.toString() === req.user.id;
  const isShopOwner = req.user.role === 'shopkeeper' && (
    parentOrder.shop?.owner?.toString() === req.user.id || 
    (parentOrder.shop?.toString && parentOrder.shop.toString() === req.user.id) // Fallback if not populated
  );
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isShopOwner && !isAdmin) {
    // If shopkeeper, verify shop ownership explicitly if not populated
    if (req.user.role === 'shopkeeper') {
      const Shop = require('../models/Shop');
      const userShop = await Shop.findOne({ owner: req.user.id });
      if (!userShop || userShop._id.toString() !== parentOrder.shop?.toString()) {
        throw new AppError('Access denied', 403);
      }
    } else {
      throw new AppError('Access denied', 403);
    }
  }

  const subOrders = await Order.find({ parentOrder: parentOrderId })
    .populate('assignedPrinter', 'displayName name type status')
    .populate('user', 'name email phone')
    .sort({ colorMode: 1 });

  res.status(200).json({
    success: true,
    data: {
      parentOrder,
      subOrders,
      count: subOrders.length,
    },
  });
});

// ─── Get Parent Order (if this is a sub-order) ────────────────────────────────
exports.getParentOrder = asyncHandler(async (req, res) => {
  const { subOrderId } = req.params;

  const subOrder = await Order.findById(subOrderId);
  if (!subOrder) throw new AppError('Sub-order not found', 404);
  if (!subOrder.parentOrder) throw new AppError('This is not a sub-order', 400);

  // Verify access
  const isOwner = subOrder.user.toString() === req.user.id;
  const isShopOwner = req.user.role === 'shopkeeper' && (
    subOrder.shop?.owner?.toString() === req.user.id || 
    (subOrder.shop?.toString && subOrder.shop.toString() === req.user.id)
  );
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isShopOwner && !isAdmin) {
    // If shopkeeper, verify shop ownership explicitly if not populated
    if (req.user.role === 'shopkeeper') {
      const Shop = require('../models/Shop');
      const userShop = await Shop.findOne({ owner: req.user.id });
      if (!userShop || userShop._id.toString() !== subOrder.shop?.toString()) {
        throw new AppError('Access denied', 403);
      }
    } else {
      throw new AppError('Access denied', 403);
    }
  }

  const parentOrder = await Order.findById(subOrder.parentOrder)
    .populate('subOrders')
    .populate('assignedPrinters.printer', 'displayName name type');

  if (!parentOrder) throw new AppError('Parent order not found', 404);

  res.status(200).json({
    success: true,
    data: {
      parentOrder,
      subOrder,
    },
  });
});

// ─── Get Order Division Status ────────────────────────────────────────────────
exports.getOrderDivisionStatus = asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const order = await Order.findById(orderId);
  if (!order) throw new AppError('Order not found', 404);

  // Verify access
  const isOwner = order.user.toString() === req.user.id;
  const isShopOwner = req.user.role === 'shopkeeper';
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isShopOwner && !isAdmin) {
    throw new AppError('Access denied', 403);
  }

  let divisionInfo = {
    isDivided: order.isDivided,
    colorMode: order.colorMode,
    isSubOrder: !!order.parentOrder,
    allSubOrdersReady: order.allSubOrdersReady,
  };

  if (order.isDivided) {
    const subOrders = await Order.find({ parentOrder: order._id })
      .select('_id colorMode status assignedPrinterName')
      .lean();

    divisionInfo.subOrders = subOrders;
    divisionInfo.subOrderCount = subOrders.length;
    divisionInfo.readyCount = subOrders.filter(o => o.status === 'ready').length;
    divisionInfo.printingCount = subOrders.filter(o => o.status === 'printing').length;
  }

  if (order.parentOrder) {
    const parentOrder = await Order.findById(order.parentOrder)
      .select('_id orderNumber isDivided')
      .lean();

    divisionInfo.parentOrder = parentOrder;

    const siblings = await Order.find({ parentOrder: order.parentOrder })
      .select('_id colorMode status')
      .lean();

    divisionInfo.siblings = siblings;
  }

  res.status(200).json({
    success: true,
    data: divisionInfo,
  });
});
