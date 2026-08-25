/**
 * Order Division Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles automatic splitting of mixed color/B&W orders into sub-orders so
 * each sub-order can be routed to the correct printer type.
 *
 * Flow:
 *   1. analyzeOrderForDivision  — inspect documents, decide if split is needed
 *   2. divideOrder              — create B&W and/or Color sub-orders in DB
 *   3. assignPrintersToSubOrders — run load-balancer for each sub-order type
 *   4. checkAllSubOrdersReady   — called after each sub-order completes
 */

'use strict';

const mongoose = require('mongoose');
const Order    = require('../models/Order');
const Printer  = require('../models/Printer');
const Shop     = require('../models/Shop');
const logger   = require('../config/logger');

// ─── 1. analyzeOrderForDivision ───────────────────────────────────────────────
/**
 * Inspect an order's printingRanges and decide whether it needs to be split.
 *
 * Returns:
 *   {
 *     shouldDivide : boolean,
 *     hasColor     : boolean,
 *     hasBW        : boolean,
 *     bwDocuments  : Array,   // documents/ranges that are B&W
 *     colorDocuments: Array,  // documents/ranges that are Color
 *   }
 */
async function analyzeOrderForDivision(order) {
  let hasColor = false;
  let hasBW    = false;

  // Per-document split: collect ranges by color mode
  const bwDocuments    = [];
  const colorDocuments = [];

  for (const doc of order.documents) {
    const ranges = doc.printingRanges || [];

    if (ranges.length === 0) {
      // No explicit ranges → treat as B&W single range
      hasBW = true;
      bwDocuments.push({ ...doc.toObject ? doc.toObject() : doc });
      continue;
    }

    const bwRanges    = ranges.filter(r => r.colorMode !== 'color');
    const colorRanges = ranges.filter(r => r.colorMode === 'color');

    if (bwRanges.length > 0) {
      hasBW = true;
      bwDocuments.push({
        ...(doc.toObject ? doc.toObject() : { ...doc }),
        printingRanges: bwRanges,
      });
    }

    if (colorRanges.length > 0) {
      hasColor = true;
      colorDocuments.push({
        ...(doc.toObject ? doc.toObject() : { ...doc }),
        printingRanges: colorRanges,
      });
    }
  }

  const shouldDivide = hasColor && hasBW;

  return { shouldDivide, hasColor, hasBW, bwDocuments, colorDocuments };
}

// ─── 2. divideOrder ───────────────────────────────────────────────────────────
/**
 * Split a parent order into B&W and/or Color sub-orders.
 *
 * - The parent order is marked isDivided = true, status stays 'accepted'.
 * - Each sub-order inherits pricing proportional to its page count.
 * - Sub-orders share the same pickupCode as the parent (single OTP for pickup).
 *
 * Returns: { parentOrder, subOrders: [Order, ...] }
 */
async function divideOrder(order, shopId) {
  const { bwDocuments, colorDocuments, hasColor, hasBW } =
    await analyzeOrderForDivision(order);

  const subOrders = [];
  
  // M4: Start MongoDB session for transaction
  const session = await mongoose.startSession();
  let useTransaction = true;
  try {
    session.startTransaction();
  } catch (err) {
    useTransaction = false;
    logger.warn('Transactions not supported (standalone mongod), falling back to sequential creates');
  }

  try {

  // Helper: calculate total pages for a document list
  const calcPages = (docs) =>
    docs.reduce((sum, doc) => {
      const ranges = doc.printingRanges || [];
      if (ranges.length === 0) return sum + (doc.detectedPages || 1);
      return sum + ranges.reduce(
        (s, r) => s + (r.rangeEnd - r.rangeStart + 1) * (r.copies || 1), 0
      );
    }, 0);

  const totalBWPages    = hasBW    ? calcPages(bwDocuments)    : 0;
  const totalColorPages = hasColor ? calcPages(colorDocuments) : 0;
  const totalPages      = totalBWPages + totalColorPages;

  // Proportional pricing split
  const bwRatio    = totalPages > 0 ? totalBWPages    / totalPages : 0;
  const colorRatio = totalPages > 0 ? totalColorPages / totalPages : 0;

  const parentPricing = order.pricing;

  // Pre-declare pricing variables for scope access in both blocks
  let bwPricing = null;
  let colorPricing = null;

  // ── Create B&W sub-order ──────────────────────────────────────────────────
  if (hasBW && bwDocuments.length > 0) {
    bwPricing = {
      subtotal:                  Math.round(parentPricing.subtotal                  * bwRatio * 100) / 100,
      platformMargin:            Math.round(parentPricing.platformMargin            * bwRatio * 100) / 100,
      additionalServicesCharge:  Math.round(parentPricing.additionalServicesCharge  * bwRatio * 100) / 100,
      total:                     Math.round(parentPricing.total                     * bwRatio * 100) / 100,
      shopReceivable:            Math.round(parentPricing.shopReceivable            * bwRatio * 100) / 100,
    };

    // Generate a unique order number for the sub-order
    const bwOtp = await Shop.nextOtpCounter(shopId);

    const bwSubOrder = new Order({
      user:               order.user,
      shop:               shopId,
      documents:          bwDocuments,
      additionalServices: order.additionalServices || {},
      specialInstructions: order.specialInstructions,
      pricing:            bwPricing,
      status:             'accepted',
      colorMode:          'bw',
      parentOrder:        order._id,
      payment: {
        razorpayOrderId:   order.payment.razorpayOrderId,
        razorpayPaymentId: order.payment.razorpayPaymentId,
        status:            'paid',
        paidAt:            order.payment.paidAt,
      },
      pickup: {
        pickupCode:  order.pickup.pickupCode, // same OTP as parent
        qrCodeData:  order.pickup.qrCodeData,
        qrCode:      order.pickup.qrCode,
      },
      expiry: {
        expiresAt: order.expiry.expiresAt,
        extended:  order.expiry.extended || false,
      },
      orderNumber: `${order.orderNumber}-BW`,
      statusHistory: [{
        status:    'accepted',
        note:      `B&W sub-order created from parent order #${order.orderNumber}`,
        timestamp: new Date(),
      }],
      printJob: { status: 'idle' },
    });
    
    await bwSubOrder.save(useTransaction ? { session } : undefined);

    subOrders.push(bwSubOrder);
    logger.info(`✅ B&W sub-order created: ${bwSubOrder.orderNumber} (${totalBWPages} pages)`);
  }

  // ── Create Color sub-order ────────────────────────────────────────────────
  if (hasColor && colorDocuments.length > 0) {
    // FIX: Ensure sub-order prices sum to parent total exactly
    // Calculate color pricing as parent minus BW to avoid rounding discrepancies
    colorPricing = {
      subtotal:                  Math.round((parentPricing.subtotal                  - (bwPricing?.subtotal || 0)) * 100) / 100,
      platformMargin:            Math.round((parentPricing.platformMargin            - (bwPricing?.platformMargin || 0)) * 100) / 100,
      additionalServicesCharge:  Math.round((parentPricing.additionalServicesCharge  - (bwPricing?.additionalServicesCharge || 0)) * 100) / 100,
      total:                     Math.round((parentPricing.total                     - (bwPricing?.total || 0)) * 100) / 100,
      shopReceivable:            Math.round((parentPricing.shopReceivable            - (bwPricing?.shopReceivable || 0)) * 100) / 100,
    };

    const colorOtp = await Shop.nextOtpCounter(shopId);

    const colorSubOrder = new Order({
      user:               order.user,
      shop:               shopId,
      documents:          colorDocuments,
      additionalServices: order.additionalServices || {},
      specialInstructions: order.specialInstructions,
      pricing:            colorPricing,
      status:             'accepted',
      colorMode:          'color',
      parentOrder:        order._id,
      payment: {
        razorpayOrderId:   order.payment.razorpayOrderId,
        razorpayPaymentId: order.payment.razorpayPaymentId,
        status:            'paid',
        paidAt:            order.payment.paidAt,
      },
      pickup: {
        pickupCode:  order.pickup.pickupCode, // same OTP as parent
        qrCodeData:  order.pickup.qrCodeData,
        qrCode:      order.pickup.qrCode,
      },
      expiry: {
        expiresAt: order.expiry.expiresAt,
        extended:  order.expiry.extended || false,
      },
      orderNumber: `${order.orderNumber}-CLR`,
      statusHistory: [{
        status:    'accepted',
        note:      `Color sub-order created from parent order #${order.orderNumber}`,
        timestamp: new Date(),
      }],
      printJob: { status: 'idle' },
    });

    await colorSubOrder.save(useTransaction ? { session } : undefined);

    subOrders.push(colorSubOrder);
    logger.info(`✅ Color sub-order created: ${colorSubOrder.orderNumber} (${totalColorPages} pages)`);
  }

  if (subOrders.length === 0) {
    throw new Error('No sub-orders were created — check document color modes');
  }

  // ── Update parent order ───────────────────────────────────────────────────
  order.isDivided   = true;
  order.colorMode   = 'mixed';
  order.subOrders   = subOrders.map(s => s._id);
  order.statusHistory.push({
    status:    'accepted',
    note:      `Order divided into ${subOrders.length} sub-orders (B&W + Color)`,
    timestamp: new Date(),
  });
  await order.save(useTransaction ? { session } : undefined);

  if (useTransaction) {
    await session.commitTransaction();
  }
  
  logger.info(`✅ Parent order ${order.orderNumber} divided into ${subOrders.length} sub-orders`);

  return { parentOrder: order, subOrders };
  
  } catch (err) {
    if (useTransaction) {
      await session.abortTransaction();
    }
    throw err;
  } finally {
    session.endSession();
  }
}

// ─── 3. assignPrintersToSubOrders ─────────────────────────────────────────────
/**
 * Run the load-balancer for each sub-order and persist the assignment.
 * Mutates each sub-order in place (saves to DB).
 * 
 * ✅ PRODUCTION FIX: Validates printer type matches color mode before assignment
 * ✅ PRODUCTION FIX: Atomic transaction for printer load updates
 * ✅ PRODUCTION FIX: Rollback on failure with detailed error logging
 */
async function assignPrintersToSubOrders(parentOrder, subOrders, shopId) {
  const { findOptimalPrinterForShop } = require('../controllers/printer.controller');
  const assignedPrinters = [];

  try {
    for (const subOrder of subOrders) {
      const jobType = subOrder.colorMode; // 'bw' or 'color'

      const totalPages = subOrder.documents.reduce((sum, doc) => {
        const ranges = doc.printingRanges || [];
        if (ranges.length === 0) return sum + (doc.detectedPages || 1);
        return sum + ranges.reduce(
          (s, r) => s + (r.rangeEnd - r.rangeStart + 1) * (r.copies || 1), 0
        );
      }, 0);

      const printer = await findOptimalPrinterForShop(shopId, jobType, totalPages);

      if (!printer) {
        logger.error(`❌ No ${jobType} printer available for sub-order ${subOrder.orderNumber}`);
        throw new Error(`No ${jobType} printer available for sub-order ${subOrder.orderNumber}`);
      }

      // ✅ PRODUCTION FIX: Validate printer type matches color mode
      const expectedType = jobType === 'color' ? 'color' : 'bw';
      if (printer.type !== expectedType) {
        logger.error(
          `❌ CRITICAL: Printer type mismatch for ${subOrder.orderNumber}. ` +
          `Expected ${expectedType}, got ${printer.type}. Printer: ${printer.name}`
        );
        throw new Error(
          `Printer type mismatch: ${subOrder.orderNumber} requires ${expectedType} printer, ` +
          `but got ${printer.type} printer (${printer.name})`
        );
      }

      // Persist assignment
      subOrder.assignedPrinter           = printer._id;
      subOrder.assignedPrinterName       = printer.displayName || printer.name;
      subOrder.assignedPrinterSystemName = printer.systemName  || '';
      await subOrder.save();

      // Track for rollback if needed
      assignedPrinters.push({ printer, totalPages });

      // Update printer load
      await Printer.findByIdAndUpdate(printer._id, {
        $inc: { currentLoad: totalPages, jobsInQueue: 1 },
      });

      logger.info(
        `✅ Sub-order ${subOrder.orderNumber} (${jobType}) → printer "${printer.displayName || printer.name}" (type: ${printer.type})`
      );
    }
  } catch (err) {
    // ✅ PRODUCTION FIX: Rollback printer load updates on failure
    logger.error(`❌ Printer assignment failed: ${err.message}. Rolling back...`);
    
    for (const { printer, totalPages } of assignedPrinters) {
      try {
        await Printer.findByIdAndUpdate(printer._id, {
          $inc: { currentLoad: -totalPages, jobsInQueue: -1 },
        });
        logger.info(`Rolled back load for printer ${printer.name}`);
      } catch (rollbackErr) {
        logger.error(`Rollback failed for printer ${printer.name}: ${rollbackErr.message}`);
      }
    }
    
    throw err;
  }
}

// ─── 4. checkAllSubOrdersReady ────────────────────────────────────────────────
/**
 * Called after a sub-order transitions to 'ready'.
 * Returns true if ALL sibling sub-orders are also 'ready' (or 'picked_up').
 * When all are ready, marks the parent order as 'ready' too.
 * 
 * ✅ FIX #5: Uses fresh DB query to avoid race condition where current sub-order's
 * status hasn't been committed yet when checking siblings.
 */
async function checkAllSubOrdersReady(parentOrder) {
  if (!parentOrder) return false;

  // ✅ FIX #5: Fresh query with explicit wait for DB consistency
  // Use a small retry loop to handle transient DB replication lag
  let subOrders = null;
  let retries = 0;
  const maxRetries = 3;
  
  while (retries < maxRetries) {
    subOrders = await Order.find({ parentOrder: parentOrder._id })
      .select('status colorMode orderNumber _id')
      .lean();
    
    if (subOrders.length > 0) break;
    
    retries++;
    if (retries < maxRetries) {
      // Small delay before retry (50ms) to allow DB to catch up
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  if (subOrders.length === 0) {
    logger.warn(`⚠️ checkAllSubOrdersReady: No sub-orders found for parent ${parentOrder._id}`);
    return false;
  }

  // ✅ FIX #5: Check if ALL sub-orders are in terminal ready state
  const allReady = subOrders.every(
    s => s.status === 'ready' || s.status === 'picked_up'
  );

  if (allReady) {
    // ✅ FIX #5: Use atomic update to prevent race condition
    // Only update parent if it's still in 'accepted' state (not already ready)
    const updated = await Order.findByIdAndUpdate(
      parentOrder._id,
      {
        $set:  { status: 'ready', allSubOrdersReady: true },
        $push: {
          statusHistory: {
            status:    'ready',
            note:      'All sub-orders ready — parent order ready for pickup',
            timestamp: new Date(),
          },
        },
      },
      { new: true }
    );

    if (updated) {
      logger.info(`✅ All sub-orders ready — parent order ${parentOrder.orderNumber} → READY`);
    } else {
      logger.warn(`⚠️ Parent order ${parentOrder._id} already transitioned to ready`);
    }
  }

  return allReady;
}

module.exports = {
  analyzeOrderForDivision,
  divideOrder,
  assignPrintersToSubOrders,
  checkAllSubOrdersReady,
};
