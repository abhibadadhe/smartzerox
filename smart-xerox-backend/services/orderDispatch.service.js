/**
 * Shared order acceptance + printer dispatch logic.
 * Used by manual acceptOrder and auto-dispatch after payment (shop open).
 */

'use strict';

const Order = require('../models/Order');
const Printer = require('../models/Printer');
const { AppError } = require('../utils/helpers');
const { emitToShop } = require('../config/socket');
const { findOptimalPrinterForShop } = require('../controllers/printer.controller');
const logger = require('../config/logger');

/**
 * Assign printers and emit order:accepted to the print agent.
 * Caller must ensure order.status is already 'accepted'.
 *
 * @returns {{ divided: boolean, order: Object, subOrders?: Object[] }}
 */
async function dispatchOrderToPrinters(order, { actorId = null, validateProduction = true } = {}) {
  if (!order.shop?._id && order.shop) {
    order = await Order.findById(order._id).populate('shop').populate('user', 'name email');
  }
  if (!order) throw new AppError('Order not found', 404);

  const shopId = order.shop._id.toString();

  if (validateProduction) {
    const { validateOrderForProduction, logValidationResults } = require('../utils/productionValidation');
    const shopPrinters = await Printer.find({ shop: order.shop._id }).lean();
    const validation = await validateOrderForProduction(order, order.shop, shopPrinters);
    logValidationResults(order.orderNumber, validation);
    if (!validation.isValid) {
      throw new AppError(
        `Order validation failed: ${validation.errors[0] || 'Unknown error'}. ` +
        `Missing printer types: ${validation.summary.missingPrinterTypes.join(', ') || 'none'}`,
        400
      );
    }
  }

  const {
    divideOrder,
    assignPrintersToSubOrders,
    analyzeOrderForDivision,
  } = require('./orderDivision.service');

  const shopPrinters = await Printer.find({ shop: order.shop._id }).lean();

  try {
    const analysis = await analyzeOrderForDivision(order);

    if (analysis.shouldDivide) {
      logger.info(`📋 Order ${order.orderNumber} has mixed color modes — dividing into sub-orders`);

      const availablePrinters = await Printer.find({
        shop: order.shop._id,
        isEnabled: true,
        status: { $ne: 'offline' },
      }).lean();

      if (analysis.hasColor && !availablePrinters.some(p => p.type === 'color')) {
        throw new AppError('Cannot accept order: No color printer available. Please enable a color printer first.', 400);
      }
      if (analysis.hasBW && !availablePrinters.some(p => p.type === 'bw')) {
        throw new AppError('Cannot accept order: No B&W printer available. Please enable a B&W printer first.', 400);
      }

      const { parentOrder, subOrders } = await divideOrder(order, order.shop._id);
      if (!subOrders?.length) {
        throw new AppError('Order division failed. Please try again or contact support.', 500);
      }

      await assignPrintersToSubOrders(parentOrder, subOrders, order.shop._id);

      const unassigned = subOrders.filter(so => !so.assignedPrinter);
      if (unassigned.length) {
        throw new AppError('Could not assign printers to all sub-orders. Please check printer availability.', 500);
      }

      for (const subOrder of subOrders) {
        const printer = shopPrinters.find(p => p._id.toString() === subOrder.assignedPrinter.toString());
        const expectedType = subOrder.colorMode === 'color' ? 'color' : 'bw';
        if (!printer || printer.type !== expectedType) {
          throw new AppError(
            `Printer type mismatch for sub-order ${subOrder.orderNumber}. Expected ${expectedType}, got ${printer?.type || 'unknown'}`,
            500
          );
        }

        if (printer.ipAddress) {
          const { printViaIpp } = require('./ippPrint.service');
          // Fire and forget
          printViaIpp(subOrder, printer).catch(err => {
            logger.error('=== IPP PRINT ERROR (sub-order) ===');
            logger.error(`Order      : ${subOrder.orderNumber}`);
            logger.error(`Printer    : ${printer.name}`);
            logger.error(`IP/Host    : ${printer.ipAddress}`);
            logger.error(`Error type : ${err.constructor?.name || 'Error'}`);
            logger.error(`Message    : ${err.message}`);
            logger.error(`Stack      : ${err.stack}`);
            logger.error('===================================');
          });
        } else {
          throw new AppError(`Printer ${printer.name} has no IP address configured for direct IPP printing.`, 400);
        }
      }

      logger.info(`✅ Order ${order.orderNumber} divided into ${subOrders.length} sub-orders`);
      return { divided: true, order: parentOrder, subOrders };
    }
  } catch (divisionErr) {
    logger.error(`❌ Order division failed for ${order.orderNumber}: ${divisionErr.message}`);
    if (divisionErr.name === 'AppError') throw divisionErr;
    throw new AppError(`Order acceptance failed: ${divisionErr.message}. Please try again or contact support.`, 500);
  }

  // Single-printer path (uniform color mode)
  let hasColor = false;
  let hasBW = false;
  order.documents.forEach(doc => {
    (doc.printingRanges || []).forEach(r => {
      if (r.colorMode === 'color') hasColor = true;
      else hasBW = true;
    });
  });

  if (hasColor && hasBW) {
    throw new AppError('Order has mixed color modes but was not divided. Please contact support.', 500);
  }

  const jobType = hasColor ? 'color' : 'bw';
  const totalPages = order.documents.reduce((sum, doc) => {
    if (doc.printingRanges?.length) {
      return sum + doc.printingRanges.reduce(
        (s, r) => s + ((r.rangeEnd - r.rangeStart + 1) * (r.copies || 1)), 0
      );
    }
    return sum + (doc.detectedPages || 1);
  }, 0);

  const optimalPrinter = await findOptimalPrinterForShop(order.shop._id, jobType, totalPages);
  if (!optimalPrinter) {
    logger.warn(`⏳ [OrderDispatch] No active ${jobType} printer online for shop ${order.shop._id} — holding Order ${order.orderNumber} safely in 'queued' status for auto-print when printer connects.`);
    order.status = 'queued';
    order.colorMode = jobType;
    await order.save();
    emitToShop(shopId, 'order:status_update', { orderId: order._id, orderNumber: order.orderNumber, status: 'queued' });
    return { divided: false, order, queued: true };
  }

  order.assignedPrinter = optimalPrinter._id;
  order.assignedPrinterName = optimalPrinter.displayName || optimalPrinter.name;
  order.assignedPrinterSystemName = optimalPrinter.systemName || '';
  order.colorMode = jobType;
  await order.save();

  const updatedPrinter = await Printer.findByIdAndUpdate(
    optimalPrinter._id,
    { $inc: { currentLoad: totalPages, jobsInQueue: 1 } },
    { new: true }
  );
  if (updatedPrinter) {
    emitToShop(shopId, 'printer:status_update', { printers: [updatedPrinter] });
  }

  logger.info(`✅ Order ${order.orderNumber} → ${order.assignedPrinterName} (${jobType})`);

  if (optimalPrinter.ipAddress) {
    const { printViaIpp } = require('./ippPrint.service');
    // Fire and forget
    printViaIpp(order, optimalPrinter).catch(err => {
      logger.error('=== IPP PRINT ERROR ===');
      logger.error(`Order      : ${order.orderNumber}`);
      logger.error(`Printer    : ${optimalPrinter.name}`);
      logger.error(`IP/Host    : ${optimalPrinter.ipAddress}`);
      logger.error(`Printer URL: ${optimalPrinter.ipAddress.match(/^(\d{1,3}\.){3}\d{1,3}$/) ? `http://${optimalPrinter.ipAddress}:631/ipp/print` : `https://${optimalPrinter.ipAddress}/ipp/print`}`);
      logger.error(`CF_ID set  : ${!!process.env.CF_ACCESS_CLIENT_ID}`);
      logger.error(`CF_SEC set : ${!!process.env.CF_ACCESS_CLIENT_SECRET}`);
      logger.error(`Error type : ${err.constructor?.name || 'Error'}`);
      logger.error(`Message    : ${err.message}`);
      logger.error(`Stack      : ${err.stack}`);
      logger.error('======================');
    });
  } else {
    throw new AppError(`Printer ${optimalPrinter.name} has no IP address configured for direct IPP printing.`, 400);
  }

  return { divided: false, order };
}

module.exports = { dispatchOrderToPrinters };
