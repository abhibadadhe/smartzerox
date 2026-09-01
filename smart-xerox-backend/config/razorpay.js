const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const createRazorpayOrder = async ({ amount, currency = 'INR', receipt, notes = {}, transfers = [] }) => {
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
    return await razorpay.orders.create(payload);
  } catch (err) {
    if (err.statusCode === 401 || err.error?.code === 'AUTHENTICATION_ERROR') {
      const msg = 'Payment gateway authentication failed. Please contact support.';
      throw new Error(`Payment gateway error: ${msg}`);
    }
    const msg = err.error?.description || err.message || 'Razorpay order creation failed';
    throw new Error(`Payment gateway error: ${msg}`);
  }
};

const verifyWebhookSignature = (rawBody, signature) => {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return expectedSignature === signature;
};

const verifyPaymentSignature = ({ orderId, paymentId, signature }) => {
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return expectedSignature === signature;
};

const fetchPayment = async (paymentId) => razorpay.payments.fetch(paymentId);
const fetchOrder = async (orderId) => razorpay.orders.fetch(orderId);

module.exports = {
  razorpay,
  createRazorpayOrder,
  verifyWebhookSignature,
  verifyPaymentSignature,
  fetchPayment,
  fetchOrder,
};
