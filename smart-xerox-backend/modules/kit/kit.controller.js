const path            = require('path');
const { v4: uuidv4 }  = require('uuid');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const moment          = require('moment');
const KitOrder        = require('./kit.model');
const { COLLEGES, COLLEGE_PARTS, SUBJECTS, NOTES_BY_SUBJECT, FIRST_YEAR_KIT } = require('./kit.data');
const { asyncHandler, AppError } = require('../../utils/helpers');
const { s3Client, BUCKET_NAME, getPresignedUrl, deleteFile } = require('../../config/aws');
const { sendEmail } = require('../../utils/email');
const logger          = require('../../config/logger');
const { performAdvancedFraudCheckV2 } = require('./kit.advanced-fraud-v2');
const { getSuspiciousOrders, getFraudStats } = require('./kit.fraud');

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function notifyUser(order, newStatus, note = '') {
  if (!order.email) return;

  const orderId   = order._id.toString().slice(-8).toUpperCase();
  const orderMeta = `${order.year} Year${order.department ? ' · ' + order.department : ' · Common Kit'} · ₹${order.totalAmount}`;

  // ── Build status-specific content ─────────────────────────────────────────
  let headerBg    = 'linear-gradient(135deg,#f97316,#ef4444)';
  let headerEmoji = '📋';
  let headline    = '';
  let bodyHtml    = '';

  if (newStatus === 'Pending Verification') {
    headerEmoji = '⏳';
    headline    = 'Order Received!';
    bodyHtml    = `<p>We've received your kit order and are currently verifying your payment screenshot.</p>
                   <p>You'll get another email once your payment is confirmed.</p>`;
  } else if (newStatus === 'Payment Verified') {
    headerBg    = 'linear-gradient(135deg,#3b82f6,#6366f1)';
    headerEmoji = '✅';
    headline    = 'Payment Verified!';
    bodyHtml    = `<p>Your payment has been verified successfully.</p>
                   <p>Your order is now being reviewed and will be accepted shortly.</p>`;
  } else if (newStatus === 'Accepted') {
    headerBg    = 'linear-gradient(135deg,#10b981,#059669)';
    headerEmoji = '🎉';
    const formattedOtp = order.kitOtp ? String(order.kitOtp).padStart(4, '0') : '';
    headline    = 'Order Accepted — Come Collect Your Notes!';
    bodyHtml    = `<p>Great news! Your kit order has been <strong>accepted</strong>.</p>
                   ${formattedOtp 
                     ? `<div style="background:#10b981;color:#fff;border-radius:12px;padding:24px;margin:20px 0;text-align:center;">
                          <p style="margin:0 0 8px;font-size:14px;opacity:0.9;">Your Collection OTP</p>
                          <p style="margin:0;font-size:42px;font-weight:bold;letter-spacing:6px;">${formattedOtp}</p>
                        </div>`
                     : ''
                   }
                   <div style="background:#f0fff4;border:2px solid #38a169;border-radius:12px;padding:18px;margin:16px 0;">
                     <p style="margin:0 0 8px;font-weight:bold;color:#276749;">📍 Visit the Shop</p>
                     <p style="margin:0;color:#555;">Come to <strong>AISSMS College Xerox Centre</strong> and ${formattedOtp ? `show your OTP <strong>${formattedOtp}</strong>` : 'show this email'} to collect your notes.</p>
                   </div>
                   <p style="color:#555;">Bring your ${formattedOtp ? `<strong>OTP: ${formattedOtp}</strong> or ` : ''}Order ID: <strong>${orderId}</strong> when you visit.</p>
                   ${note ? `<p style="color:#888;font-size:13px;font-style:italic;">Note from shop: ${note}</p>` : ''}`;
  } else if (newStatus === 'Rejected') {
    headerBg    = 'linear-gradient(135deg,#ef4444,#dc2626)';
    headerEmoji = '❌';
    headline    = 'Order Rejected';
    bodyHtml    = `<p>Unfortunately, your kit order has been <strong>rejected</strong>.</p>
                   ${note
                     ? `<div style="background:#fff5f5;border-left:4px solid #ef4444;padding:14px 18px;border-radius:0 8px 8px 0;margin:16px 0;">
                          <p style="margin:0;font-weight:bold;color:#c53030;">Reason:</p>
                          <p style="margin:6px 0 0;color:#555;">${note}</p>
                        </div>`
                     : '<p style="color:#888;">No specific reason was provided.</p>'
                   }
                   <p>If you believe this is a mistake, please contact us or place a new order.</p>`;
  } else if (newStatus === 'Suspicious') {
    // Fix #11: Neutral "under review" message — don't reveal fraud detection to user
    headerBg    = 'linear-gradient(135deg,#f59e0b,#d97706)';
    headerEmoji = '🔍';
    headline    = 'Payment Under Review';
    bodyHtml    = `<p>Your kit order is currently <strong>under review</strong>.</p>
                   <p>Our team needs to verify your payment details. This usually takes <strong>24–48 hours</strong>.</p>
                   <div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:14px 18px;border-radius:0 8px 8px 0;margin:16px 0;">
                     <p style="margin:0;font-weight:bold;color:#92400e;">What does this mean?</p>
                     <p style="margin:6px 0 0;color:#555;">Some payments require additional verification for security purposes. If everything checks out, your order will be processed shortly.</p>
                   </div>
                   <p style="color:#888;">If you have questions, reply to this email or contact us.</p>`;
  } else if (newStatus === 'Completed') {
    headerBg    = 'linear-gradient(135deg,#10b981,#059669)';
    headerEmoji = '🎊';
    headline    = 'Order Completed!';
    bodyHtml    = `<p>Your kit order has been marked as <strong>completed</strong>. Thank you!</p>
                   <p>We hope the notes are helpful. All the best for your studies! 📚</p>`;
  }

  try {
    await sendEmail({
      to:      order.email,
      subject: `${headerEmoji} Kit Order ${newStatus} — Pratibimb`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <div style="background:${headerBg};padding:24px;border-radius:10px 10px 0 0;text-align:center;">
            <div style="font-size:36px;margin-bottom:8px;">${headerEmoji}</div>
            <h1 style="color:#fff;margin:0;font-size:22px;">${headline}</h1>
            <p style="color:rgba(255,255,255,.85);margin:6px 0 0;font-size:14px;">Pratibimb — Academic Kit Orders</p>
          </div>
          <div style="background:#fff;padding:28px;border:1px solid #eee;border-top:none;">
            <h2 style="margin:0 0 16px;font-size:18px;">Hello ${order.name}!</h2>
            ${bodyHtml}
            <hr style="border:none;border-top:1px solid #eee;margin:20px 0;" />
            <table style="width:100%;font-size:13px;color:#6c757d;">
              <tr><td>Order ID</td><td style="text-align:right;font-weight:bold;color:#333;">#${orderId}</td></tr>
              <tr><td>Details</td><td style="text-align:right;">${orderMeta}</td></tr>
            </table>
          </div>
          <div style="background:#f8f9fa;padding:14px;border-radius:0 0 10px 10px;text-align:center;">
            <p style="color:#6c757d;font-size:12px;margin:0;">© ${new Date().getFullYear()} Pratibimb. All rights reserved.</p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    logger.warn(`Kit order email failed for ${order.email}: ${err.message}`);
  }
}

// ─── GET /kit/years ───────────────────────────────────────────────────────────
exports.getYears = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { years: ['1st', '2nd', '3rd', '4th'] } });
});

// ─── GET /kit/colleges ────────────────────────────────────────────────────────
exports.getColleges = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { colleges: COLLEGES } });
});

// ─── GET /kit/college-parts?college=COE ───────────────────────────────────────
exports.getCollegeParts = asyncHandler(async (req, res) => {
  const { college } = req.query;
  if (!college) throw new AppError('college is required', 400);
  const parts = COLLEGE_PARTS[college];
  if (!parts) throw new AppError('College not found', 404);
  res.json({ success: true, data: { parts } });
});

// ─── GET /kit/departments ─────────────────────────────────────────────────────
exports.getDepartments = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { departments: ['Computer','IT','Electrical','E&TC','AIOS','Instrumentation'] } });
});

// ─── GET /kit/subjects?year=2nd&department=Computer ──────────────────────────
exports.getSubjects = asyncHandler(async (req, res) => {
  const { year, department } = req.query;
  if (!year || year === '1st') {
    return res.json({ success: true, data: { subjects: [], firstYearKit: FIRST_YEAR_KIT } });
  }
  if (!department) throw new AppError('department is required for 2nd–4th year', 400);
  const subjects = SUBJECTS[year]?.[department];
  if (!subjects) throw new AppError('No subjects found for this year/department', 404);
  res.json({ success: true, data: { subjects } });
});

// ─── GET /kit/notes?subject=DBMS ─────────────────────────────────────────────
exports.getNotes = asyncHandler(async (req, res) => {
  const { subject } = req.query;
  if (!subject) throw new AppError('subject is required', 400);
  res.json({ success: true, data: { notes: NOTES_BY_SUBJECT(subject) } });
});

// ─── POST /kit/create-order ───────────────────────────────────────────────────
exports.createOrder = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('Payment screenshot is required', 400);

  const { name, phone, email, year, department, selectedNotes, orderType, totalAmount, transactionId, specialInstructions } = req.body;

  if (!name || !phone || !email || !year || !orderType || !totalAmount) {
    throw new AppError('name, phone, email, year, orderType and totalAmount are required', 400);
  }

  const trimmedTxnId = (transactionId || '').trim();
  if (!trimmedTxnId || trimmedTxnId.length < 8) {
    throw new AppError('Please enter a valid UPI Transaction / UTR ID (at least 8 characters).', 400);
  }

  const dummyTxnRegex = /^(UPI\d+|0{6,}|1{6,}|2{6,}|3{6,}|4{6,}|5{6,}|6{6,}|7{6,}|8{6,}|9{6,}|123456|12345678|123456789|1234567890|123456789012|987654321|098765456|0987654321|test|demo|asdf|qwerty|null|undefined)/i;
  if (dummyTxnRegex.test(trimmedTxnId)) {
    throw new AppError('Invalid UPI Transaction ID. Please enter the authentic 12-digit numeric UTR number from your GPay, PhonePe, or Paytm payment receipt.', 400);
  }

  // ─── STRICT UNIQUE TRANSACTION ID ENFORCEMENT ──────────────────────────────
  const normalisedTxnId = trimmedTxnId.toUpperCase();
  const existingTxnOrder = await KitOrder.findOne({
    transactionId: { $regex: new RegExp(`^${normalisedTxnId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
  }).select('_id orderStatus createdAt').lean();

  if (existingTxnOrder) {
    throw new AppError('This UPI Transaction ID / UTR has already been used for another order. Every payment transaction ID must be unique.', 400);
  }

  // Get shopkeeper ID (for UPI verification)
  const Shop = require('../../models/Shop');
  const shop = await Shop.findOne().select('owner').lean();
  const shopkeeperId = shop?.owner;

  // ─── PERFORM FRAUD DETECTION ──────────────────────────────────────────────
  const fraudCheckResult = await performAdvancedFraudCheckV2(
    { 
      userId:        req.user?.id || null, 
      email, 
      phone, 
      transactionId, 
      totalAmount:   Number(totalAmount),
    },
    req.file,
    shopkeeperId
  );

  // Upload screenshot to S3 (do this regardless of fraud outcome — shopkeeper needs to view it)
  const userId = req.user?.id || 'guest';
  const ext    = path.extname(req.file.originalname).toLowerCase() || '.jpg';
  const s3Key  = `kit-screenshots/${userId}/${uuidv4()}${ext}`;

  await s3Client.send(new PutObjectCommand({
    Bucket:      BUCKET_NAME,
    Key:         s3Key,
    Body:        req.file.buffer,
    ContentType: req.file.mimetype,
  }));

  let parsedNotes = [];
  try { parsedNotes = JSON.parse(selectedNotes || '[]'); } catch { parsedNotes = []; }

  // ─── DETERMINE INITIAL STATUS ─────────────────────────────────────────────
  // Clean order  → Pending Verification (shopkeeper reviews payment screenshot)
  // Fraud signal → Suspicious           (shopkeeper reviews fraud flags before processing)
  const initialStatus        = fraudCheckResult.isSuspicious ? 'Suspicious' : 'Pending Verification';
  const initialPaymentStatus = fraudCheckResult.isSuspicious ? 'Suspicious' : 'Pending';

  // Build a human-readable status note (never include raw payment values)
  const statusNote = fraudCheckResult.isSuspicious
    ? `Auto-flagged by fraud engine (score ${fraudCheckResult.fraudFlags.fraudScore}): ${fraudCheckResult.fraudFlags.flagReason}`
    : 'Order received — awaiting payment verification.';

  const order = await KitOrder.create({
    userId:              req.user?.id || null,
    name, phone, email, year,
    department:          year === '1st' ? null : (department || null),
    selectedNotes:       parsedNotes,
    orderType,
    totalAmount:         Number(totalAmount),
    screenshotS3Key:     s3Key,
    screenshotHash:      fraudCheckResult.screenshotHash || '',
    transactionId:       transactionId.trim().toUpperCase(),  // Fix #5: normalise for case-insensitive dedup
    specialInstructions: specialInstructions || '',
    paymentStatus:       initialPaymentStatus,
    orderStatus:         initialStatus,
    fraudFlags:          fraudCheckResult.fraudFlags,
    statusHistory: [{
      status: initialStatus,
      note:   statusNote,
      at:     new Date(),
    }],
  });

  // ─── STRUCTURED LOGGING (no sensitive payment data) ───────────────────────
  if (fraudCheckResult.isSuspicious) {
    logger.warn(`[KitOrder] 🚨 SUSPICIOUS order=${order._id} score=${fraudCheckResult.fraudFlags.fraudScore} flags="${fraudCheckResult.fraudFlags.flagReason}"`);
  } else {
    logger.info(`[KitOrder] ✅ Created order=${order._id} status=PendingVerification score=${fraudCheckResult.fraudFlags.fraudScore}`);
  }

  res.status(201).json({
    success: true,
    message: fraudCheckResult.isSuspicious 
      ? 'Order placed! Your payment proof is under review due to security checks.'
      : 'Order placed! We will verify your payment and update you shortly.',
    data:    { orderId: order._id, orderStatus: order.orderStatus, isSuspicious: fraudCheckResult.isSuspicious },
  });
});

// ─── GET /kit/my-orders — user tracks their own orders ────────────────────────
exports.getMyOrders = asyncHandler(async (req, res) => {
  const { email, phone } = req.query;

  // Logged-in user → fetch by userId; guest → fetch by email+phone
  let filter = {};
  if (req.user?.id) {
    filter = { userId: req.user.id };
  } else if (email && phone) {
    filter = { email: email.toLowerCase(), phone };
  } else {
    throw new AppError('Provide email and phone to track your order', 400);
  }

  const orders = await KitOrder.find(filter)
    .sort({ createdAt: -1 })
    .select('-screenshotS3Key') // don't expose S3 key to user
    .lean();

  res.json({ success: true, data: { orders } });
});

// ─── GET /kit/order/:id — single order status (user) ─────────────────────────
exports.getOrderStatus = asyncHandler(async (req, res) => {
  const order = await KitOrder.findById(req.params.id)
    .select('-screenshotS3Key')
    .lean();
  if (!order) throw new AppError('Order not found', 404);

  // Allow access if logged-in owner OR matching email+phone in query
  const isOwner = req.user?.id && order.userId?.toString() === req.user.id;
  const { email, phone } = req.query;
  const isGuest = email && phone && order.email === email.toLowerCase() && order.phone === phone;

  if (!isOwner && !isGuest) throw new AppError('Access denied', 403);

  res.json({ success: true, data: { order } });
});

// ─── GET /kit/shopkeeper/kit-orders ──────────────────────────────────────────
exports.getKitOrders = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status && status !== 'All') filter.orderStatus = status;

  const skip = (Number(page) - 1) * Number(limit);
  const [orders, total] = await Promise.all([
    KitOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    KitOrder.countDocuments(filter),
  ]);

  // Generate presigned screenshot URLs (15 min expiry) for shopkeeper to view
  const ordersWithUrls = await Promise.all(orders.map(async (o) => {
    let screenshotUrl = null;
    if (o.screenshotS3Key) {
      try { screenshotUrl = await getPresignedUrl(o.screenshotS3Key, 900); } catch {}
    }
    return { ...o, screenshotUrl };
  }));

  res.json({
    success: true,
    data: {
      orders: ordersWithUrls,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    },
  });
});

// ─── PATCH /kit/shopkeeper/kit-order/:id/status ───────────────────────────────
// Status transitions:
//   Pending Verification → Payment Verified  (shopkeeper verified payment)
//   Payment Verified     → Accepted          (shopkeeper accepts the order + assigns OTP)
//   Payment Verified     → Rejected          (shopkeeper rejects)
//   Accepted             → Completed         (order fulfilled)
//   Suspicious           → Payment Verified (shopkeeper approves after fraud review)
//   Suspicious           → Rejected (shopkeeper rejects after fraud review)
exports.updateKitOrderStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;

  const validTransitions = {
    'Pending Verification': ['Payment Verified', 'Rejected'],
    'Payment Verified':     ['Accepted', 'Rejected'],
    'Accepted':             ['Completed'],
    'Suspicious':           ['Payment Verified', 'Rejected'], // Suspicious must go to Payment Verified first, then Accepted
  };

  const order = await KitOrder.findById(req.params.id);
  if (!order) throw new AppError('Kit order not found', 404);

  const allowed = validTransitions[order.orderStatus];
  if (!allowed || !allowed.includes(status)) {
    throw new AppError(`Cannot transition from "${order.orderStatus}" to "${status}"`, 400);
  }

  // ─── ASSIGN AUTO-INCREMENTING OTP ONLY WHEN ORDER IS ACCEPTED ──────────────
  // OTP is NOT assigned for:
  // - Suspicious orders (must be reviewed first)
  // - Payment Verified (needs manual acceptance)
  // - Rejected orders
  // OTP is ONLY assigned when order moves to "Accepted" status
  if (status === 'Accepted' && !order.kitOtp) {
    order.kitOtp = await KitOrder.getNextKitOtp();
    logger.info(`[KitOrder] Assigned OTP ${order.kitOtp} to order ${order._id}`);
  }

  order.orderStatus = status;
  if (status === 'Payment Verified') order.paymentStatus = 'Verified';
  if (status === 'Rejected')         order.paymentStatus = 'Failed';

  order.statusHistory.push({ status, note: note || '', updatedBy: req.user.id, at: new Date() });
  await order.save({ validateBeforeSave: false }); // skip validators — old orders may lack screenshotS3Key

  // Email user on meaningful status changes (Fix #11: also notify on Pending/Suspicious)
  if (['Pending Verification', 'Suspicious', 'Accepted', 'Rejected', 'Payment Verified'].includes(status)) {
    await notifyUser(order, status, note);
  }

  res.json({ success: true, message: `Order marked as ${status}`, data: { order } });
});


// ─── GET /kit/shopkeeper/suspicious-orders ──────────────────────────────────────
exports.getSuspiciousOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;

  const result = await getSuspiciousOrders(Number(page), Number(limit));

  // Generate presigned screenshot URLs for shopkeeper to view
  const ordersWithUrls = await Promise.all(result.orders.map(async (o) => {
    let screenshotUrl = null;
    if (o.screenshotS3Key) {
      try { screenshotUrl = await getPresignedUrl(o.screenshotS3Key, 900); } catch {}
    }
    return { ...o, screenshotUrl };
  }));

  res.json({
    success: true,
    data: {
      orders: ordersWithUrls,
      pagination: result.pagination,
    },
  });
});

// ─── GET /kit/shopkeeper/fraud-stats ────────────────────────────────────────────
exports.getFraudStats = asyncHandler(async (req, res) => {
  const stats = await getFraudStats();
  res.json({ success: true, data: { stats } });
});

// ─── GET /kit/shopkeeper/order-counts ──────────────────────────────────────────
// Fix #14: Lightweight endpoint for tab badge counts — no full document transfer
exports.getOrderCounts = asyncHandler(async (_req, res) => {
  const counts = await KitOrder.aggregate([{
    $group: {
      _id: '$orderStatus',
      count: { $sum: 1 },
    },
  }]);

  const result = { pending: 0, active: 0, suspicious: 0, history: 0, total: 0 };
  for (const { _id: status, count } of counts) {
    result.total += count;
    if (['Pending Verification', 'Payment Verified'].includes(status)) result.pending += count;
    else if (status === 'Accepted')  result.active += count;
    else if (status === 'Suspicious') result.suspicious += count;
    else if (['Completed', 'Rejected'].includes(status)) result.history += count;
  }

  res.json({ success: true, data: { counts: result } });
});

// ─── POST /kit/shopkeeper/verify-otp ─────────────────────────────────────────
exports.verifyKitOtp = asyncHandler(async (req, res) => {
  const { otp } = req.body;
  if (!otp) throw new AppError('OTP is required', 400);

  // Find order with this OTP that is in 'Accepted' status
  const order = await KitOrder.findOne({ kitOtp: String(otp).trim(), orderStatus: 'Accepted' });
  if (!order) {
    throw new AppError('Invalid OTP or order is not in Accepted status', 400);
  }

  order.orderStatus = 'Completed';
  order.statusHistory.push({
    status: 'Completed',
    note: 'Kit picked up and OTP verified successfully',
    updatedBy: req.user.id,
    at: new Date()
  });

  await order.save();

  // Notify user that kit was picked up
  await notifyUser(order, 'Completed', 'Your kit has been picked up. Thank you!');

  res.json({
    success: true,
    message: 'OTP verified successfully. Order marked as Completed.',
    data: { order }
  });
});

// ─── POST /kit/admin/reset-15days ───────────────────────────────────────────
exports.resetFifteenDayKitOrders = asyncHandler(async (req, res) => {
  const days = Number(req.body.days || 15);
  const cutoffDate = moment().subtract(days, 'days').toDate();

  const oldOrders = await KitOrder.find({
    createdAt: { $lt: cutoffDate },
    dataArchived: { $ne: true }
  });

  let archivedCount = 0;
  for (const order of oldOrders) {
    if (order.screenshotS3Key) {
      try {
        await deleteFile(order.screenshotS3Key);
        order.screenshotS3Key = null;
      } catch (err) {
        logger.warn(`S3 delete failed for kit screenshot ${order.screenshotS3Key}: ${err.message}`);
      }
    }
    order.dataArchived = true;
    order.archivedAt = new Date();
    await order.save({ validateBeforeSave: false });
    archivedCount++;
  }

  logger.info(`[KitOrder] 15-Day batch archival executed: ${archivedCount} orders archived.`);
  res.json({
    success: true,
    message: `Successfully reset & archived ${archivedCount} kit order(s) older than ${days} days.`,
    data: { archivedCount, cutoffDate }
  });
});

// ─── GET /kit/admin/student-report ──────────────────────────────────────────
exports.getStudentReport = asyncHandler(async (req, res) => {
  const { days = 7, status } = req.query;
  const filter = {};
  if (days && days !== 'all') {
    const cutoff = moment().subtract(Number(days), 'days').toDate();
    filter.createdAt = { $gte: cutoff };
  }
  if (status && status !== 'all' && status) {
    filter.orderStatus = status;
  }

  const orders = await KitOrder.find(filter)
    .sort({ createdAt: -1 })
    .lean();

  const reportData = orders.map((o) => ({
    orderId: o._id,
    orderIdShort: o._id.toString().slice(-8).toUpperCase(),
    name: o.name,
    phone: o.phone,
    email: o.email,
    year: o.year,
    department: o.department || 'First Year Common',
    orderType: o.orderType,
    selectedNotes: (o.selectedNotes || []).map(n => n.title || n.id).join('; ') || 'Full Kit',
    totalAmount: o.totalAmount,
    kitOtp: o.kitOtp || '-',
    paymentStatus: o.paymentStatus,
    orderStatus: o.orderStatus,
    transactionId: o.transactionId || '-',
    fraudScore: o.fraudFlags?.fraudScore || 0,
    isSuspicious: o.orderStatus === 'Suspicious' || (o.fraudFlags?.fraudScore >= 60),
    dataArchived: Boolean(o.dataArchived),
    date: o.createdAt,
  }));

  res.json({
    success: true,
    data: {
      total: reportData.length,
      rangeDays: days,
      report: reportData,
    }
  });
});

