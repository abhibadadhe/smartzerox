'use strict';

const WebhookEvent = require('../models/WebhookEvent');
const Order = require('../models/Order');
const { finalizePaymentCapture } = require('./paymentSync.service');
const logger = require('../config/logger');

const MAX_RETRIES = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000];

async function logWebhookResult({
  eventId,
  eventType,
  razorpayOrderId,
  razorpayPaymentId,
  status,
  error = null,
  payloadSummary = {},
}) {
  const doc = {
    eventId: eventId || `${eventType}:${razorpayOrderId || Date.now()}`,
    eventType,
    razorpayOrderId,
    razorpayPaymentId,
    status,
    error,
    payloadSummary,
    processedAt: status === 'processed' ? new Date() : undefined,
  };

  if (status === 'failed' || status === 'retry_pending') {
    doc.retryCount = 0;
    doc.nextRetryAt = new Date(Date.now() + RETRY_DELAYS_MS[0]);
    doc.status = 'retry_pending';
  }

  await WebhookEvent.findOneAndUpdate(
    { eventId: doc.eventId },
    { $set: doc },
    { upsert: true, new: true }
  );
}

async function retryFailedWebhooks() {
  const now = new Date();
  const pending = await WebhookEvent.find({
    status: 'retry_pending',
    eventType: 'payment.captured',
    retryCount: { $lt: MAX_RETRIES },
    nextRetryAt: { $lte: now },
  }).limit(20);

  let retried = 0;
  let succeeded = 0;

  for (const evt of pending) {
    retried++;
    try {
      const order = await Order.findOne({ 'payment.razorpayOrderId': evt.razorpayOrderId });
      if (!order || order.status !== 'pending_payment') {
        await WebhookEvent.updateOne(
          { _id: evt._id },
          { $set: { status: 'processed', processedAt: new Date(), error: null } }
        );
        succeeded++;
        continue;
      }

      const amountPaise = evt.payloadSummary?.amountPaise;
      if (!amountPaise) {
        throw new Error('Missing amount in webhook payload summary');
      }

      await finalizePaymentCapture({
        razorpayOrderId: evt.razorpayOrderId,
        razorpayPaymentId: evt.razorpayPaymentId,
        amountPaise,
        webhookVerified: true,
        paymentMeta: evt.payloadSummary?.paymentMeta || {},
      });

      await WebhookEvent.updateOne(
        { _id: evt._id },
        { $set: { status: 'processed', processedAt: new Date(), error: null } }
      );
      succeeded++;
      logger.info(`Webhook retry succeeded for order ${evt.razorpayOrderId}`);
    } catch (err) {
      const nextRetry = evt.retryCount + 1;
      const delay = RETRY_DELAYS_MS[Math.min(nextRetry, RETRY_DELAYS_MS.length - 1)];
      await WebhookEvent.updateOne(
        { _id: evt._id },
        {
          $set: {
            retryCount: nextRetry,
            error: err.message,
            nextRetryAt: nextRetry >= MAX_RETRIES ? null : new Date(Date.now() + delay),
            status: nextRetry >= MAX_RETRIES ? 'failed' : 'retry_pending',
          },
        }
      );
      logger.error(`Webhook retry ${nextRetry}/${MAX_RETRIES} failed for ${evt.razorpayOrderId}: ${err.message}`);
    }
  }

  if (retried > 0) {
    logger.info(`Webhook retry batch: ${succeeded}/${retried} succeeded`);
  }
  return { retried, succeeded };
}

module.exports = { logWebhookResult, retryFailedWebhooks };
