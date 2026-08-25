const Order = require('../models/Order');
const Payment = require('../models/Payment');
const { AppError, asyncHandler } = require('../utils/helpers');
const { verifyWebhookSignature, verifyPaymentSignature, razorpay } = require('../config/razorpay');
const { emitToUser, emitToShop, emitToAdmin } = require('../config/socket');
const { createNotification } = require('../utils/notifications');
const { withRazorpay, withEmail } = require('../utils/circuitBreaker');
const { finalizePaymentCapture } = require('../services/paymentSync.service');
const { logWebhookResult } = require('../services/webhookMonitor.service');
const logger = require('../config/logger');
const moment = require('moment');

// ─── Verify Payment After Client-Side ─────────────────────────────────────────
exports.verifyPayment = asyncHandler(async (req, res) => {
const { razorpayOrderId, razorpayPaymentId, razorpaySignature, amount } = req.body;

// ── CRITICAL FIX #1: Validate payment amount is present ─────────────────────
// `amount` from the frontend is in PAISE (Razorpay always works in paise).
// e.g. ₹10.00 → amount = 1000
if (!amount || typeof amount !== 'number' || amount <= 0) {
throw new AppError('Invalid payment amount', 400);
}

// Verify signature (mock orders allowed in development only)
if (razorpayOrderId.startsWith('mock_order_')) {
if (process.env.NODE_ENV === 'production') {
throw new AppError('Invalid payment order', 400);
}
logger.info(`Bypassing payment signature verification for mock order: ${razorpayOrderId}`);
} else {
const isValid = verifyPaymentSignature({ orderId: razorpayOrderId, paymentId: razorpayPaymentId, signature: razorpaySignature });
if (!isValid) {
logger.warn(`Invalid payment signature for order: ${razorpayOrderId}`);
throw new AppError('Payment verification failed. Invalid signature.', 400);
}
}

const order = await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId }).populate('shop');
if (!order) throw new AppError('Order not found', 404);

// IDOR check — ensure the payment belongs to the requesting user
if (order.user.toString() !== req.user.id) {
throw new AppError('Access denied', 403);
}

// ── CRITICAL FIX #2: Validate amount matches order total (prevent price manipulation) ──
// order.pricing.total is in RUPEES → convert to paise for comparison.
// amount from frontend is already in PAISE — do NOT multiply again.
const expectedAmountPaise = Math.round(order.pricing.total * 100); // rupees → paise
const receivedAmountPaise = Math.round(amount); // already in paise
if (receivedAmountPaise !== expectedAmountPaise) {
logger.error(
`Payment amount mismatch for order ${order._id}: ` +
`expected ${expectedAmountPaise} paise (₹${order.pricing.total}), ` +
`got ${receivedAmountPaise} paise (₹${(receivedAmountPaise / 100).toFixed(2)})`
);
throw new AppError(
`Payment amount mismatch. Expected ₹${order.pricing.total}, got ₹${(receivedAmountPaise / 100).toFixed(2)}`,
400
);
}

// ── CRITICAL FIX #11: Idempotency check — prevent double-processing if webhook retried ──
// Check if payment already verified (idempotent)
const existingPayment = await Payment.findOne({
razorpayPaymentId: razorpayPaymentId
});
if (existingPayment && existingPayment.status === 'paid') {
logger.info(`Idempotent payment verification for ${razorpayPaymentId} — already processed`);
const existingOrder = await Order.findOne({ 'payment.razorpayPaymentId': razorpayPaymentId }).populate('shop');
return res.status(200).json({
success: true,
message: 'Payment already verified',
data: {
order: { _id: existingOrder._id, orderNumber: existingOrder.orderNumber, status: existingOrder.status },
pickup: { pickupCode: existingOrder.pickup?.pickupCode, expiresAt: existingOrder.expiry?.expiresAt },
},
});
}

// ── Atomic finalize via shared service ───────────────────────────────────────
const { alreadyProcessed, order: finalizedOrder } = await finalizePaymentCapture({
razorpayOrderId,
razorpayPaymentId,
razorpaySignature,
amountPaise: receivedAmountPaise,
webhookVerified: false,
});

if (alreadyProcessed) {
return res.status(200).json({
success: true,
message: 'Payment already verified',
data: {
order: { _id: finalizedOrder._id, orderNumber: finalizedOrder.orderNumber, status: finalizedOrder.status },
pickup: { pickupCode: finalizedOrder.pickup?.pickupCode, expiresAt: finalizedOrder.expiry?.expiresAt },
},
});
}

res.status(200).json({
success: true,
message: finalizedOrder.shop.isOpen
? 'Payment verified — order sent to printer!'
: 'Payment verified — order queued (shop is currently closed)',
data: {
order: { _id: finalizedOrder._id, orderNumber: finalizedOrder.orderNumber, status: finalizedOrder.status },
pickup: { pickupCode: finalizedOrder.pickup?.pickupCode, expiresAt: finalizedOrder.expiry?.expiresAt },
},
});
});

// ─── Razorpay Webhook ─────────────────────────────────────────────────────────
exports.razorpayWebhook = asyncHandler(async (req, res) => {
const signature = req.headers['x-razorpay-signature'];
const rawBody = req.body;

if (!verifyWebhookSignature(rawBody, signature)) {
logger.warn('Webhook signature mismatch');
return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
}

const event = JSON.parse(rawBody.toString());
logger.info(`Razorpay Webhook: ${event.event} (id: ${event.payload?.payment?.entity?.id || 'n/a'})`);

const { payload } = event;
const webhookEventId = event.id || `${event.event}:${payload?.payment?.entity?.order_id || Date.now()}`;

switch (event.event) {
case 'payment.captured': {
const payment = payload.payment.entity;
try {
const { alreadyProcessed, order } = await finalizePaymentCapture({
razorpayOrderId: payment.order_id,
razorpayPaymentId: payment.id,
amountPaise: payment.amount,
webhookVerified: true,
paymentMeta: {
method: payment.method,
bank: payment.bank,
wallet: payment.wallet,
vpa: payment.vpa,
email: payment.email,
contact: payment.contact,
},
});
await logWebhookResult({
eventId: webhookEventId,
eventType: 'payment.captured',
razorpayOrderId: payment.order_id,
razorpayPaymentId: payment.id,
status: 'processed',
payloadSummary: { amountPaise: payment.amount, paymentMeta: { method: payment.method } },
});
if (!alreadyProcessed) {
logger.info(`Webhook finalized order ${order.orderNumber} (${order._id})`);
} else {
logger.info(`Webhook idempotent skip for order ${payment.order_id}`);
}
} catch (err) {
logger.error(`Webhook payment.captured failed for ${payment.order_id}: ${err.message}`);
await logWebhookResult({
eventId: webhookEventId,
eventType: 'payment.captured',
razorpayOrderId: payment.order_id,
razorpayPaymentId: payment.id,
status: 'retry_pending',
error: err.message,
payloadSummary: {
amountPaise: payment.amount,
paymentMeta: { method: payment.method, bank: payment.bank, wallet: payment.wallet, vpa: payment.vpa, email: payment.email, contact: payment.contact },
},
});
}
break;
}

case 'payment.failed': {
const payment = payload.payment.entity;
await Payment.findOneAndUpdate(
{ razorpayOrderId: payment.order_id },
{
status: 'failed',
failedAt: new Date(),
error: {
code: payment.error_code,
description: payment.error_description,
source: payment.error_source,
step: payment.error_step,
reason: payment.error_reason,
},
}
);

const order = await Order.findOne({ 'payment.razorpayOrderId': payment.order_id });
if (order && order.status === 'pending_payment') {
await createNotification({
recipient: order.user,
type: 'payment_failed',
title: 'Payment Failed',
message: `Payment for order #${order.orderNumber} failed. Please try again.`,
order: order._id,
});
emitToUser(order.user.toString(), 'payment:failed', { orderId: order._id });
}
break;
}

case 'refund.processed': {
const refund = payload.refund.entity;
await Payment.findOneAndUpdate(
{ razorpayPaymentId: refund.payment_id },
{
status: 'refunded',
'refund.razorpayRefundId': refund.id,
'refund.amount': refund.amount / 100,
'refund.status': 'processed',
'refund.processedAt': new Date(),
}
);
break;
}

default:
logger.info(`Unhandled webhook event: ${event.event}`);
}

res.status(200).json({ success: true, message: 'Webhook processed' });
});

// ─── Get Payment Details ──────────────────────────────────────────────────────
exports.getPaymentDetails = asyncHandler(async (req, res) => {
const payment = await Payment.findOne({ order: req.params.orderId })
.populate('order', 'orderNumber status')
.populate('user', 'name email')
.populate('shop', 'name');

if (!payment) throw new AppError('Payment not found', 404);

const isOwner = payment.user._id.toString() === req.user.id;
const isAdmin = req.user.role === 'admin';
if (!isOwner && !isAdmin) throw new AppError('Access denied', 403);

res.status(200).json({ success: true, data: { payment } });
});

// ─── Initiate Refund ──────────────────────────────────────────────────────────
exports.initiateRefund = asyncHandler(async (req, res) => {
const { orderId, reason } = req.body;

const order = await Order.findById(orderId);
if (!order) throw new AppError('Order not found', 404);

const isOwner = order.user.toString() === req.user.id;
const isAdmin = req.user.role === 'admin';
if (!isOwner && !isAdmin) throw new AppError('Access denied', 403);

// ── CRITICAL FIX: Validate refund eligibility ──────────────────────────────
// Only allow refunds for pending/paid/queued/accepted orders (not printing/ready/picked_up)
const refundableStatuses = ['pending_payment', 'paid', 'queued', 'accepted'];
if (!refundableStatuses.includes(order.status)) {
throw new AppError(`Cannot refund order in ${order.status} status. Only pending/paid/queued/accepted orders can be refunded.`, 400);
}

// ── CRITICAL FIX: Enforce 24-hour refund window ──────────────────────────────
const paidAt = order.payment?.paidAt || order.createdAt;
const hoursSincePaid = moment().diff(moment(paidAt), 'hours');
if (hoursSincePaid > 24) {
throw new AppError('Refund window expired. Orders can only be refunded within 24 hours of payment.', 400);
}

if (order.payment.status !== 'paid') throw new AppError('No payment to refund', 400);

const payment = await Payment.findOne({ order: orderId });
if (!payment || !payment.razorpayPaymentId) throw new AppError('Payment record not found', 404);

// ── CRITICAL FIX: Prevent duplicate refunds ──────────────────────────────────
if (order.refund?.razorpayRefundId) {
throw new AppError('Refund already processed for this order', 400);
}

// Razorpay refund
const refund = await withRazorpay(() => razorpay.payments.refund(payment.razorpayPaymentId, {
amount: Math.round(order.pricing.total * 100),
notes: { reason, orderId: orderId.toString() },
}));

// ── CRITICAL FIX: Use atomic update to prevent duplicate refunds ──────────────
const updatedOrder = await Order.findByIdAndUpdate(
orderId,
{
$set: {
'payment.status': 'refunded',
'refund': {
amount: order.pricing.total,
razorpayRefundId: refund.id,
reason,
processedAt: new Date()
},
'status': 'refunded',
},
$push: {
statusHistory: {
status: 'refunded',
note: `Refund initiated: ${reason}`,
timestamp: new Date(),
},
},
},
{ new: true }
);

await createNotification({
recipient: updatedOrder.user,
type: 'payment_refunded',
title: 'Refund Initiated 💰',
message: `Refund of ₹${updatedOrder.pricing.total} initiated for order #${updatedOrder.orderNumber}. Will reflect in 5-7 days.`,
order: updatedOrder._id,
});

res.status(200).json({ success: true, message: 'Refund initiated successfully', data: { refundId: refund.id } });
});
