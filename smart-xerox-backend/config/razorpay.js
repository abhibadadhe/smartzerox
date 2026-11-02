const Razorpay = require('razorpay');
const crypto = require('crypto');

const defaultRazorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Returns a Razorpay client instance.
 * If custom keyId & keySecret are provided, creates an instance for that merchant/shopkeeper.
 * Otherwise returns the default platform instance.
 */
const getRazorpayInstance = ({ keyId, keySecret } = {}) => {
  if (keyId && keySecret) {
    return new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }
  return defaultRazorpay;
};

const createRazorpayOrder = async ({ amount, currency = 'INR', receipt, notes = {}, transfers = [], keyId, keySecret }) => {
  // Razorpay minimum is ₹1 (100 paise)
  const amountInPaise = Math.max(Math.round(amount * 100), 100);
  try {
    const payload = {
      amount: amountInPaise,
      currency,
      receipt,
      notes,
    };
    if (transfers && Array.isArray(transfers) && transfers.length > 0) {
      payload.transfers = transfers;
    }
    const client = getRazorpayInstance({ keyId, keySecret });
    return await client.orders.create(payload);
  } catch (err) {
    if (err.statusCode === 401 || err.error?.code === 'AUTHENTICATION_ERROR') {
      const msg = 'Payment gateway authentication failed. Please verify Razorpay keys.';
      throw new Error(`Payment gateway error: ${msg}`);
    }
    const msg = err.error?.description || err.message || 'Razorpay order creation failed';
    throw new Error(`Payment gateway error: ${msg}`);
  }
};

const verifyWebhookSignature = (rawBody, signature, secret = process.env.RAZORPAY_WEBHOOK_SECRET) => {
  const expectedSignature = crypto
    .createHmac('sha256', secret || process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return expectedSignature === signature;
};

const verifyPaymentSignature = ({ orderId, paymentId, signature, keySecret }) => {
  const secretToUse = keySecret || process.env.RAZORPAY_KEY_SECRET;
  const expectedSignature = crypto
    .createHmac('sha256', secretToUse)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return expectedSignature === signature;
};

const fetchPayment = async (paymentId, credentials = {}) => {
  const client = getRazorpayInstance(credentials);
  return client.payments.fetch(paymentId);
};

const fetchOrder = async (orderId, credentials = {}) => {
  const client = getRazorpayInstance(credentials);
  return client.orders.fetch(orderId);
};

module.exports = {
  razorpay: defaultRazorpay,
  getRazorpayInstance,
  createRazorpayOrder,
  verifyWebhookSignature,
  verifyPaymentSignature,
  fetchPayment,
  fetchOrder,
};
