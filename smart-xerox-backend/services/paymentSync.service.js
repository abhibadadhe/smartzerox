/**
 * Shared payment finalization — used by client verify and Razorpay webhook.
 */

'use strict';

const Order = require('../models/Order');
const Payment = require('../models/Payment');
const { AppError } = require('../utils/helpers');
const { emitToUser, emitToShop, emitToAdmin } = require('../config/socket');
const { createNotification } = require('../utils/notifications');
const { dispatchOrderToPrinters } = require('./orderDispatch.service');
const logger = require('../config/logger');
const moment = require('moment');

/**
 * Atomically transition order from pending_payment → paid + queued/accepted.
 * Idempotent if already processed.
 *
 * @returns {{ alreadyProcessed: boolean, order: Object }}
 */
async function finalizePaymentCapture({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature = null,
  amountPaise,
  webhookVerified = false,
  paymentMeta = {},
}) {
  const order = await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId }).populate('shop');
  if (!order) throw new AppError('Order not found', 404);

  if (order.status !== 'pending_payment') {
    return { alreadyProcessed: true, order };
  }

  const expectedAmountPaise = Math.round(order.pricing.total * 100);
  if (Math.round(amountPaise) !== expectedAmountPaise) {
    throw new AppError(
      `Payment amount mismatch. Expected ₹${order.pricing.total}, got ₹${(amountPaise / 100).toFixed(2)}`,
      400
    );
  }

  // Order goes to 'accepted' ONLY if shop is currently open (toggle ON + inside operating hours).
  // Otherwise, order goes to 'queued' and will be auto-dispatched when shop opens.
  const isShopOpen = typeof order.shop.isCurrentlyOpen === 'function' 
    ? order.shop.isCurrentlyOpen() 
    : order.shop.isOpen;

  const newStatus = isShopOpen ? 'accepted' : 'queued';
  const now = new Date();

  const setFields = {
    'payment.razorpayPaymentId': razorpayPaymentId,
    'payment.status': 'paid',
    'payment.paidAt': now,
    status: newStatus,
  };
  if (razorpaySignature) setFields['payment.razorpaySignature'] = razorpaySignature;
  if (newStatus === 'accepted') {
    setFields['expiry.expiresAt'] = moment().add(parseInt(process.env.ORDER_EXPIRY_HOURS) || 12, 'hours').toDate();
  }

  const updatedOrder = await Order.findOneAndUpdate(
    { _id: order._id, status: 'pending_payment' },
    {
      $set: setFields,
      $push: {
        statusHistory: {
          $each: [
            { status: 'paid', note: webhookVerified ? 'Payment captured (webhook)' : 'Payment verified', timestamp: now },
            {
              status: newStatus,
              note: newStatus === 'accepted' 
                ? 'Auto-accepted — shop is open' 
                : 'Shop is closed/outside hours — order held in queue',
              timestamp: now,
            },
          ],
        },
      },
    },
    { new: true }
  ).populate('shop');

  if (!updatedOrder) {
    const existing = await Order.findById(order._id).populate('shop');
    return { alreadyProcessed: true, order: existing };
  }

  if (!updatedOrder.orderNumber) {
    updatedOrder.orderNumber = updatedOrder.pickup.pickupCode;
    updatedOrder.pickup.qrCodeData = JSON.stringify({
      orderId: updatedOrder._id,
      otp: updatedOrder.pickup.pickupCode,
      orderNumber: updatedOrder.orderNumber,
    });
    await updatedOrder.save();
    logger.info(`✅ Order number assigned after payment: #${updatedOrder.orderNumber}`);
  }

  await Payment.findOneAndUpdate(
    { razorpayOrderId },
    {
      razorpayPaymentId,
      ...(razorpaySignature ? { razorpaySignature } : {}),
      status: 'paid',
      paidAt: now,
      webhookVerified,
      ...paymentMeta,
    }
  );

  await createNotification({
    recipient: updatedOrder.user,
    type: 'payment_success',
    title: 'Payment Successful! 💳',
    message: newStatus === 'accepted'
      ? `Payment of ₹${updatedOrder.pricing.total} received. Order #${updatedOrder.orderNumber} is being printed!`
      : `Payment of ₹${updatedOrder.pricing.total} received. Order #${updatedOrder.orderNumber} is queued — will print when shop opens.`,
    order: updatedOrder._id,
  });
  emitToUser(updatedOrder.user.toString(), 'payment:success', {
    orderId: updatedOrder._id,
    orderNumber: updatedOrder.orderNumber,
    status: updatedOrder.status,
  });

  await createNotification({
    recipient: updatedOrder.shop.owner,
    type: 'new_order_shop',
    title: 'New Order Received! 📋',
    message: `New order #${updatedOrder.orderNumber} received. ${updatedOrder.documents.length} document(s) to print.`,
    order: updatedOrder._id,
  });
  emitToShop(updatedOrder.shop._id.toString(), 'order:new', {
    orderId: updatedOrder._id,
    orderNumber: updatedOrder.orderNumber,
    documentCount: updatedOrder.documents.length,
    total: updatedOrder.pricing.total,
    status: updatedOrder.status,
  });
  emitToAdmin('order:new', {
    orderId: updatedOrder._id,
    shopId: updatedOrder.shop._id,
    amount: updatedOrder.pricing.total,
  });

  if (isShopOpen) {
    setImmediate(async () => {
      try {
        const freshOrder = await Order.findById(updatedOrder._id).populate('shop').populate('user', 'name email');
        if (freshOrder?.status === 'accepted') {
          await dispatchOrderToPrinters(freshOrder, { actorId: null, validateProduction: true });
        }
      } catch (err) {
        logger.error(`Auto-dispatch failed for order ${updatedOrder.orderNumber}: ${err.message}`);
      }
    });
  }

  return { alreadyProcessed: false, order: updatedOrder };
}

module.exports = { finalizePaymentCapture };
