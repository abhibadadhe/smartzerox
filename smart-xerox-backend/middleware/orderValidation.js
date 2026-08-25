/**
 * Order Validation & Status Enforcement Middleware
 * Ensures orders follow valid state transitions and enforces business rules
 */

const Order = require('../models/Order');
const { AppError } = require('../utils/helpers');
const logger = require('../config/logger');
const moment = require('moment');

/**
 * Valid order status transitions
 * Maps current status → allowed next statuses
 */
const VALID_TRANSITIONS = {
  'pending_payment': ['paid', 'cancelled', 'expired'],
  'paid': ['queued', 'accepted', 'cancelled'],
  'queued': ['accepted', 'rejected', 'cancelled', 'expired'],
  'accepted': ['printing', 'rejected', 'cancelled', 'expired'],
  'printing': ['ready', 'rejected', 'cancelled', 'expired'],
  'ready': ['picked_up', 'expired', 'cancelled'],
  'picked_up': [], // Terminal state
  'rejected': [], // Terminal state
  'cancelled': [], // Terminal state
  'expired': [], // Terminal state
  'refunded': [], // Terminal state
};

/**
 * Middleware: Enforce order expiry
 * Automatically transitions expired orders to 'expired' status
 * Should be called before any order operation
 */
const enforceOrderExpiry = async (req, res, next) => {
  try {
    const orderId = req.params.id || req.params.orderId || req.body.orderId;
    if (!orderId) return next();

    const order = await Order.findById(orderId);
    if (!order) return next();

    // Check if order is expired
    if (order.expiry?.expiresAt && moment().isAfter(moment(order.expiry.expiresAt))) {
      // Only transition if not already in terminal state
      if (!['picked_up', 'expired', 'cancelled', 'refunded'].includes(order.status)) {
        logger.warn(`Order ${order.orderNumber} expired at ${order.expiry.expiresAt}`);
        
        order.status = 'expired';
        order.addStatusHistory('expired', 'Order expired — not picked up within time limit', null);
        await order.save();

        // Emit socket event to notify user
        const { emitToUser } = require('../config/socket');
        emitToUser(order.user.toString(), 'order:expired', {
          orderId: order._id,
          orderNumber: order.orderNumber,
          expiresAt: order.expiry.expiresAt,
        });
      }
    }

    next();
  } catch (err) {
    logger.error(`Order expiry enforcement failed: ${err.message}`);
    next(); // Don't block request on error
  }
};

/**
 * Middleware: Validate order status transition
 * Ensures status changes follow valid state machine
 * Usage: app.use(validateStatusTransition) or on specific routes
 */
const validateStatusTransition = (currentStatus, newStatus) => {
  if (currentStatus === newStatus) {
    return true; // Idempotent
  }

  const allowedTransitions = VALID_TRANSITIONS[currentStatus];
  if (!allowedTransitions) {
    throw new AppError(`Unknown order status: ${currentStatus}`, 500);
  }

  if (!allowedTransitions.includes(newStatus)) {
    throw new AppError(
      `Invalid status transition: ${currentStatus} → ${newStatus}. Allowed: ${allowedTransitions.join(', ')}`,
      400
    );
  }

  return true;
};

/**
 * Middleware: Validate order can be refunded
 * Checks eligibility and time window
 */
const validateRefundEligibility = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  // Only allow refunds for pending/paid/queued/accepted orders
  const refundableStatuses = ['pending_payment', 'paid', 'queued', 'accepted'];
  if (!refundableStatuses.includes(order.status)) {
    throw new AppError(
      `Cannot refund order in ${order.status} status. Only pending/paid/queued/accepted orders can be refunded.`,
      400
    );
  }

  // Enforce 24-hour refund window
  const paidAt = order.payment?.paidAt || order.createdAt;
  const hoursSincePaid = moment().diff(moment(paidAt), 'hours');
  if (hoursSincePaid > 24) {
    throw new AppError(
      'Refund window expired. Orders can only be refunded within 24 hours of payment.',
      400
    );
  }

  // Prevent duplicate refunds
  if (order.refund?.razorpayRefundId) {
    throw new AppError('Refund already processed for this order', 400);
  }

  return order;
};

/**
 * Middleware: Validate order can be cancelled
 * Checks eligibility and prevents cancellation of completed orders
 */
const validateCancellationEligibility = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  // Cannot cancel terminal states
  const terminalStatuses = ['picked_up', 'cancelled', 'refunded'];
  if (terminalStatuses.includes(order.status)) {
    throw new AppError(
      `Cannot cancel order in ${order.status} status.`,
      400
    );
  }

  // Cannot cancel if already printing (too late)
  if (['printing', 'ready'].includes(order.status)) {
    throw new AppError(
      'Cannot cancel order that is already printing or ready for pickup.',
      400
    );
  }

  return order;
};

/**
 * Middleware: Validate printer assignment
 * Ensures printer is online and has capacity
 */
const validatePrinterAssignment = async (printerId) => {
  const Printer = require('../models/Printer');
  const printer = await Printer.findById(printerId);
  
  if (!printer) {
    throw new AppError('Printer not found', 404);
  }

  if (printer.status === 'offline') {
    throw new AppError('Printer is offline. Cannot assign job.', 400);
  }

  if (printer.status === 'error') {
    throw new AppError('Printer has an error. Cannot assign job.', 400);
  }

  // Check if printer load is reasonable (not overloaded)
  if (printer.currentLoad > 10000) { // 10000 pages threshold
    throw new AppError('Printer is overloaded. Try another printer.', 400);
  }

  return printer;
};

/**
 * Middleware: Validate order can be picked up
 * Ensures order is ready and OTP is valid
 */
const validatePickupEligibility = async (orderId, pickupCode) => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  if (order.status !== 'ready') {
    throw new AppError(
      `Order is not ready for pickup. Current status: ${order.status}`,
      400
    );
  }

  if (order.expiry?.expiresAt && moment().isAfter(moment(order.expiry.expiresAt))) {
    throw new AppError('Order has expired. Cannot pick up.', 400);
  }

  if (!order.pickup?.pickupCode) {
    throw new AppError('No pickup code found for this order.', 400);
  }

  if (order.pickup.pickupCode !== pickupCode) {
    throw new AppError('Invalid pickup code. Please check with customer.', 400);
  }

  return order;
};

/**
 * Middleware: Validate order can be extended
 * Ensures order hasn't been extended too many times
 */
const validateExtensionEligibility = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  if (!['ready', 'expired'].includes(order.status)) {
    throw new AppError(
      `Cannot extend order in ${order.status} status. Only ready or expired orders can be extended.`,
      400
    );
  }

  // Limit extensions to 2 times
  const extensionCount = order.expiry?.extensionCount || 0;
  if (extensionCount >= 2) {
    throw new AppError('Order can only be extended 2 times. Please pick up or contact support.', 400);
  }

  return order;
};

module.exports = {
  enforceOrderExpiry,
  validateStatusTransition,
  validateRefundEligibility,
  validateCancellationEligibility,
  validatePrinterAssignment,
  validatePickupEligibility,
  validateExtensionEligibility,
  VALID_TRANSITIONS,
};
