const cron = require('node-cron');
const Order = require('../models/Order');
const { createNotification } = require('../utils/notifications');
const { emitToUser, emitToShop } = require('../config/socket');
const { deleteFile } = require('../config/aws');
const logger = require('../config/logger');
const moment = require('moment');
const { acquireLock } = require('../utils/cronLock');
const { withRazorpay } = require('../utils/circuitBreaker');

// ─── Shared helper: delete S3 files for an order and null out s3Key ──────────
async function deleteOrderS3Files(order) {
  let deleted = 0;
  for (const doc of order.documents) {
    if (!doc.s3Key) continue;
    try {
      await deleteFile(doc.s3Key);
      doc.s3Key = null; // prevent re-deletion on next cron run
      deleted++;
    } catch (err) {
      logger.warn(`S3 delete failed for key ${doc.s3Key}: ${err.message}`);
    }
  }
  if (deleted > 0) {
    await order.save({ validateBeforeSave: false });
  }
  return deleted;
}

/**
 * Check for expiring orders - run every 30 minutes
 * Notify users/shops 1 hour before expiry
 */
const checkExpiringOrders = cron.schedule('*/30 * * * *', async () => {
  // Distributed lock: 29 min TTL (slightly less than interval to avoid overlap)
  if (!(await acquireLock('checkExpiringOrders', 29 * 60 * 1000))) return;
  try {
    const oneHourFromNow = moment().add(1, 'hour').toDate();
    const now = new Date();

    const expiringOrders = await Order.find({
      status: { $in: ['paid', 'accepted', 'printing', 'ready'] },
      'expiry.expiresAt': { $gte: now, $lte: oneHourFromNow },
      'expiry.extended': false,
    }).select('_id orderNumber user shop expiry');

    for (const order of expiringOrders) {
      const minutesLeft = Math.round((order.expiry.expiresAt - now) / 60000);

      await createNotification({
        recipient: order.user,
        type: 'order_expiring_soon',
        title: '⏰ Order Expiring Soon!',
        message: `Your order #${order.orderNumber} expires in ${minutesLeft} minutes. Collect or extend now!`,
        order: order._id,
        priority: 'high',
      });

      emitToUser(order.user.toString(), 'order:expiring_soon', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        expiresAt: order.expiry.expiresAt,
        minutesLeft,
      });
    }

    if (expiringOrders.length > 0) {
      logger.info(`Expiry alerts sent for ${expiringOrders.length} orders`);
    }
  } catch (err) {
    logger.error('Expiry check cron error:', err);
  }
}, { scheduled: false });

/**
 * Expire overdue orders - run every 15 minutes
 * Uses bulkWrite for efficiency under load instead of individual saves
 */
const expireOrders = cron.schedule('*/15 * * * *', async () => {
  // Distributed lock: 14 min TTL
  if (!(await acquireLock('expireOrders', 14 * 60 * 1000))) return;
  try {
    const now = new Date();

    // ✅ FIX #4: Exclude 'printing' status to prevent mid-print file deletion
    // Orders in 'printing' should complete before expiry check
    // Use lean() for the query — we only need _id, user, shop, orderNumber for notifications
    const expiredOrders = await Order.find({
      status: { $in: ['paid', 'accepted', 'ready'] }, // Removed 'printing'
      'expiry.expiresAt': { $lt: now },
    }).select('_id orderNumber user shop documents payment pricing').lean();

    // Log if any printing orders are past expiry (for monitoring)
    const stalePrintingOrders = await Order.countDocuments({
      status: 'printing',
      'expiry.expiresAt': { $lt: now },
    });
    if (stalePrintingOrders > 0) {
      logger.warn(`⚠️ ${stalePrintingOrders} printing order(s) past expiry (waiting for completion)`);
    }

    if (expiredOrders.length === 0) return;

    // Bulk update all statuses in one DB round-trip
    const ids = expiredOrders.map(o => o._id);
    await Order.updateMany(
      { _id: { $in: ids } },
      {
        $set:  { status: 'expired' },
        $push: { statusHistory: { status: 'expired', note: 'Order expired automatically', timestamp: now } },
      }
    );

    // S3 cleanup + notifications + auto-refund in parallel batches
    await Promise.allSettled(expiredOrders.map(async (order) => {
      // Delete S3 files
      for (const doc of order.documents) {
        if (!doc.s3Key) continue;
        try {
          await deleteFile(doc.s3Key);
          await Order.updateOne(
            { _id: order._id, 'documents._id': doc._id },
            { $set: { 'documents.$.s3Key': null } }
          );
        } catch (err) {
          logger.warn(`S3 delete failed for key ${doc.s3Key}: ${err.message}`);
        }
      }

      // ── FIX #6: Auto-refund on expiry for paid orders ──────────────────────
      // Only refund if payment was captured and no refund already exists
      if (order.payment?.status === 'paid' && order.payment?.razorpayPaymentId) {
        try {
          const Payment = require('../models/Payment');
          const existingPayment = await Payment.findOne({ order: order._id });
          const alreadyRefunded = existingPayment?.refund?.razorpayRefundId;

          if (!alreadyRefunded) {
            const { razorpay } = require('../config/razorpay');
            const refund = await withRazorpay(() => razorpay.payments.refund(order.payment.razorpayPaymentId, {
              amount: Math.round(order.pricing.total * 100),
              notes: { reason: 'Order expired — auto-refund', orderId: order._id.toString() },
            }));

            await Order.findByIdAndUpdate(order._id, {
              $set: {
                'payment.status': 'refunded',
                refund: {
                  amount: order.pricing.total,
                  razorpayRefundId: refund.id,
                  reason: 'Order expired — auto-refund',
                  processedAt: new Date(),
                },
              },
            });

            await Payment.findOneAndUpdate(
              { order: order._id },
              { status: 'refunded', 'refund.razorpayRefundId': refund.id, 'refund.amount': order.pricing.total, 'refund.status': 'processed', 'refund.processedAt': new Date() }
            );

            logger.info(`Auto-refund ₹${order.pricing.total} initiated for expired order ${order.orderNumber}: ${refund.id}`);

            await createNotification({
              recipient: order.user,
              type: 'payment_refunded',
              title: 'Order Expired — Refund Initiated 💰',
              message: `Your order #${order.orderNumber} expired. Refund of ₹${order.pricing.total} has been initiated and will reflect in 5-7 days.`,
              order: order._id,
              priority: 'high',
            });
          }
        } catch (refundErr) {
          logger.error(`Auto-refund failed for expired order ${order.orderNumber}: ${refundErr.message}`);
          // Notify user to contact support if auto-refund fails
          await createNotification({
            recipient: order.user,
            type: 'order_expired',
            title: 'Order Expired',
            message: `Your order #${order.orderNumber} has expired. Please contact support for a refund.`,
            order: order._id,
            priority: 'high',
          });
        }
      } else {
        // No payment captured — just notify
        await createNotification({
          recipient: order.user,
          type: 'order_expired',
          title: 'Order Expired',
          message: `Your order #${order.orderNumber} has expired. Contact support for refund queries.`,
          order: order._id,
          priority: 'high',
        });
      }

      emitToUser(order.user.toString(), 'order:expired', { orderId: order._id, orderNumber: order.orderNumber });
      emitToShop(order.shop.toString(), 'order:expired', { orderId: order._id, orderNumber: order.orderNumber });
    }));

    logger.info(`Expired ${expiredOrders.length} orders`);
  } catch (err) {
    logger.error('Order expiry cron error:', err);
  }
}, { scheduled: false });

/**
 * Expire pending payments older than 12 hours - run every 30 minutes
 */
const expirePendingPayments = cron.schedule('*/30 * * * *', async () => {
  // Distributed lock: 29 min TTL
  if (!(await acquireLock('expirePendingPayments', 29 * 60 * 1000))) return;
  try {
    const twelveHoursAgo = moment().subtract(12, 'hours').toDate();
    const pendingOrders = await Order.find({
      status: 'pending_payment',
      createdAt: { $lt: twelveHoursAgo },
    });

    for (const order of pendingOrders) {
      order.status = 'cancelled';
      order.statusHistory.push({
        status: 'cancelled',
        note: 'Order cancelled: Payment pending for over 12 hours',
        timestamp: new Date(),
      });
      await order.save();

      // Delete S3 files since payment failed
      await deleteOrderS3Files(order);
    }

    if (pendingOrders.length > 0) {
      logger.info(`Cancelled ${pendingOrders.length} pending payments older than 12 hours`);
    }
  } catch (err) {
    logger.error('Pending payment expiry cron error:', err);
  }
}, { scheduled: false });

/**
 * S3 cleanup — runs daily at 2 AM
 *
 * Deletes files for:
 *   - picked_up orders older than 24h (printing done, no longer needed)
 *   - rejected orders older than 24h  (never printed, safe to delete)
 *   - refunded orders older than 24h
 *   - expired/cancelled orders older than 7 days (safety net — should already be deleted)
 *
 * Skips docs where s3Key is already null (already cleaned up).
 * Nulls out s3Key after deletion to prevent re-runs hitting the same key.
 */
const cleanupOldFiles = cron.schedule('0 2 * * *', async () => {
  // Distributed lock: 55 min TTL (daily job, generous window)
  if (!(await acquireLock('cleanupOldFiles', 55 * 60 * 1000))) return;
  try {
    let totalDeleted = 0;

    // ── Tier 1: picked_up / rejected / refunded — delete after 24h ──────────
    const oneDayAgo = moment().subtract(24, 'hours').toDate();
    const tier1Orders = await Order.find({
      status:    { $in: ['picked_up', 'rejected', 'refunded'] },
      updatedAt: { $lt: oneDayAgo },
      'documents.s3Key': { $ne: null }, // only orders that still have files
    });

    for (const order of tier1Orders) {
      totalDeleted += await deleteOrderS3Files(order);
    }

    // ── Tier 2: expired / cancelled — safety net after 7 days ───────────────
    // (should already be deleted by immediate cron, but catches any that slipped through)
    const sevenDaysAgo = moment().subtract(7, 'days').toDate();
    const tier2Orders = await Order.find({
      status:    { $in: ['expired', 'cancelled'] },
      updatedAt: { $lt: sevenDaysAgo },
      'documents.s3Key': { $ne: null },
    });

    for (const order of tier2Orders) {
      totalDeleted += await deleteOrderS3Files(order);
    }

    if (totalDeleted > 0) {
      logger.info(`S3 cleanup: deleted ${totalDeleted} file(s) from ${tier1Orders.length + tier2Orders.length} order(s)`);
    } else {
      logger.info('S3 cleanup: nothing to delete');
    }
  } catch (err) {
    logger.error('S3 cleanup cron error:', err);
  }
}, { scheduled: false });

/**
 * 1-Month Order Document Data Archival — runs daily at 3 AM
 * 
 * Resets heavy file document data after 30 days while 100% preserving
 * all financial revenue data (pricing totals, payments, shop balance, settlements).
 */
const archiveOneMonthOldOrders = cron.schedule('0 3 * * *', async () => {
  if (!(await acquireLock('archiveOneMonthOldOrders', 55 * 60 * 1000))) return;
  try {
    const thirtyDaysAgo = moment().subtract(30, 'days').toDate();
    
    // Find all orders older than 30 days that have not been archived yet
    const oldOrders = await Order.find({
      createdAt: { $lt: thirtyDaysAgo },
      dataArchived: { $ne: true }
    });

    let count = 0;
    for (const order of oldOrders) {
      // Delete any associated S3 files
      await deleteOrderS3Files(order);

      // Strip heavy document file payloads while keeping basic metadata
      order.documents = (order.documents || []).map(doc => ({
        _id: doc._id,
        originalName: doc.originalName || 'Archived Document',
        pageCount: doc.pageCount || 0,
        s3Key: null,
        s3Url: null,
        printingRanges: doc.printingRanges || []
      }));

      order.dataArchived = true;
      order.archivedAt = new Date();

      // Save without changing pricing or revenue
      await order.save({ validateBeforeSave: false });
      count++;
    }

    // ── Also archive 30-day old Kit Orders ─────────────────────────────────
    const KitOrder = require('../modules/kit/kit.model');
    const oldKitOrders = await KitOrder.find({
      createdAt: { $lt: thirtyDaysAgo },
      dataArchived: { $ne: true }
    });

    let kitCount = 0;
    for (const kitOrder of oldKitOrders) {
      if (kitOrder.screenshotS3Key) {
        try {
          await deleteFile(kitOrder.screenshotS3Key);
          kitOrder.screenshotS3Key = null;
        } catch (err) {
          logger.warn(`S3 delete failed for kit screenshot ${kitOrder.screenshotS3Key}: ${err.message}`);
        }
      }

      kitOrder.dataArchived = true;
      kitOrder.archivedAt = new Date();
      await kitOrder.save({ validateBeforeSave: false });
      kitCount++;
    }

    if (count > 0 || kitCount > 0) {
      logger.info(`📦 1-Month Archival: Reset file data for ${count} standard order(s) and ${kitCount} kit order(s) (>30 days old) while preserving all revenue records.`);
    }
  } catch (err) {
    logger.error('1-Month order archival cron error:', err);
  }
}, { scheduled: false });

/**
 * Auto-hide completed/terminal orders from dashboards after 24 hours.
 * Runs every hour.
 *
 * User side  — hides from My Orders:  picked_up / rejected / cancelled / expired
 * Shop side  — hides from History tab: picked_up / rejected / cancelled / expired
 */
const autoHideOldOrders = cron.schedule('0 * * * *', async () => {
  // Distributed lock: 59 min TTL
  if (!(await acquireLock('autoHideOldOrders', 59 * 60 * 1000))) return;
  try {
    const oneDayAgo = moment().subtract(24, 'hours').toDate();
    const terminalStatuses = ['picked_up', 'rejected', 'cancelled', 'expired'];

    // ── Hide from user My Orders ──────────────────────────────────────────────
    const userResult = await Order.updateMany(
      {
        status:         { $in: terminalStatuses },
        hiddenFromUser: { $ne: true },
        updatedAt:      { $lt: oneDayAgo },
      },
      { $set: { hiddenFromUser: true, hiddenAt: new Date() } }
    );

    // ── Hide from shop History tab ────────────────────────────────────────────
    const shopResult = await Order.updateMany(
      {
        status:         { $in: terminalStatuses },
        hiddenFromShop: { $ne: true },
        updatedAt:      { $lt: oneDayAgo },
      },
      { $set: { hiddenFromShop: true, hiddenFromShopAt: new Date() } }
    );

    const total = userResult.modifiedCount + shopResult.modifiedCount;
    if (total > 0) {
      logger.info(`Auto-hidden: ${userResult.modifiedCount} from user dashboards, ${shopResult.modifiedCount} from shop history (>24h old)`);
    }
  } catch (err) {
    logger.error('Auto-hide orders cron error:', err);
  }
}, { scheduled: false });

/**
 * Auto-retry incomplete print jobs after 30 minutes
 * Runs every 15 minutes
 *
 * Incomplete jobs are marked for retry if:
 * - Status is 'incomplete'
 * - Last error was > 30 minutes ago
 * - Retry count < 3
 *
 * After 3 retries, mark as 'failed' (manual intervention needed)
 */
const autoRetryIncompleteJobs = cron.schedule('*/15 * * * *', async () => {
  // Distributed lock: 14 min TTL
  if (!(await acquireLock('autoRetryIncompleteJobs', 14 * 60 * 1000))) return;
  try {
    const thirtyMinutesAgo = moment().subtract(30, 'minutes').toDate();

    // Find incomplete jobs ready for retry
    const incompleteJobs = await Order.find({
      'printJob.status': 'incomplete',
      'printJob.verificationFailed': true,
      updatedAt: { $lt: thirtyMinutesAgo },
      'printJob.retryCount': { $lt: 3 },
    }).select('_id orderNumber shop printJob');

    for (const order of incompleteJobs) {
      // Reset to queued for retry
      order.printJob.status = 'queued';
      order.printJob.verificationFailed = false;
      order.printJob.retryCount = (order.printJob.retryCount || 0) + 1;
      order.printJob.lastError = null;
      await order.save({ validateBeforeSave: false });

      // Emit to print agent to retry
      const { printViaIpp } = require('../services/ippPrint.service');
      const Printer = require('../models/Printer');
      const p = await Printer.findById(order.assignedPrinter);
      if (p) printViaIpp(order, p).catch(err => console.error(err.message));

      logger.info(`Auto-retry initiated for order ${order.orderNumber} (attempt ${order.printJob.retryCount})`);
    }

    // Mark jobs with 3+ retries as failed
    const failedJobs = await Order.find({
      'printJob.status': 'incomplete',
      'printJob.retryCount': { $gte: 3 },
    });

    for (const order of failedJobs) {
      order.printJob.status = 'failed';
      order.printJob.lastError = 'Max retries exceeded (3) — manual intervention required';
      await order.save({ validateBeforeSave: false });

      // Notify shopkeeper
      const { createNotification } = require('../utils/notifications');
      const Shop = require('../models/Shop');
      const shop = await Shop.findById(order.shop);

      await createNotification({
        recipient: shop.owner,
        type: 'system',
        title: '❌ Print Job Failed',
        message: `Order #${order.orderNumber} failed after 3 retry attempts. Manual review required.`,
        order: order._id,
        priority: 'high',
      });

      logger.warn(`Order ${order.orderNumber} marked FAILED after 3 retries`);
    }

    if (incompleteJobs.length > 0 || failedJobs.length > 0) {
      logger.info(`Incomplete jobs: ${incompleteJobs.length} retried, ${failedJobs.length} marked failed`);
    }
  } catch (err) {
    logger.error('Auto-retry incomplete jobs cron error:', err);
  }
}, { scheduled: false });

/**
 * Mark stale printers as offline - run every 5 minutes
 * Printers not seen in 5 minutes are marked offline
 */
const markStalePrintersOffline = cron.schedule('*/5 * * * *', async () => {
  // Distributed lock: 4 min TTL
  if (!(await acquireLock('markStalePrintersOffline', 4 * 60 * 1000))) return;
  try {
    const Printer = require('../models/Printer');
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const result = await Printer.updateMany(
      { lastSeen: { $lt: fiveMinutesAgo }, status: 'running' },
      { status: 'offline' }
    );

    if (result.modifiedCount > 0) {
      logger.info(`Marked ${result.modifiedCount} stale printers as offline`);
    }
  } catch (err) {
    logger.error('Mark stale printers offline cron error:', err);
  }
}, { scheduled: false });

/**
 * Reassign queued jobs from offline printers - run every 10 minutes
 * If a printer goes offline while jobs are queued, reassign to another printer
 */
const reassignOfflinePrinterJobs = cron.schedule('*/10 * * * *', async () => {
  // Distributed lock: 9 min TTL
  if (!(await acquireLock('reassignOfflinePrinterJobs', 9 * 60 * 1000))) return;
  try {
    const Printer = require('../models/Printer');
    const Shop = require('../models/Shop');
    const { findOptimalPrinterForShop } = require('../controllers/printer.controller');
    const { emitToShop } = require('../config/socket');
// Find all orders assigned to offline printers
    const offlinePrinters = await Printer.find({ status: 'offline' });
    
    for (const offlinePrinter of offlinePrinters) {
      const queuedOrders = await Order.find({
        assignedPrinter: offlinePrinter._id,
        'printJob.status': { $in: ['idle', 'queued'] },
      });

      for (const order of queuedOrders) {
        try {
          // Calculate job type and pages
          const hasColor = order.documents.some(doc =>
            doc.printingRanges?.some(r => r.colorMode === 'color')
          );
          const jobType = hasColor ? 'color' : 'bw';
          const totalPages = order.documents.reduce((sum, doc) =>
            sum + (doc.printingRanges?.reduce((s, r) => s + ((r.rangeEnd - r.rangeStart + 1) * (r.copies || 1)), 0) || doc.detectedPages || 1), 0
          );

          // Find new optimal printer
          const newPrinter = await findOptimalPrinterForShop(order.shop, jobType, totalPages);
          
          if (newPrinter && newPrinter._id.toString() !== offlinePrinter._id.toString()) {
            // Decrease load on old printer
            offlinePrinter.currentLoad = Math.max(0, offlinePrinter.currentLoad - totalPages);
            offlinePrinter.jobsInQueue = Math.max(0, offlinePrinter.jobsInQueue - 1);
            await offlinePrinter.save();

            // Assign to new printer — include systemName so agent routes to correct physical printer
            order.assignedPrinter           = newPrinter._id;
            order.assignedPrinterName       = newPrinter.displayName || newPrinter.name;
            order.assignedPrinterSystemName = newPrinter.systemName || '';
            await order.save();

            // Update new printer's load counter and push live update to dashboard
            const updatedNewPrinter = await Printer.findByIdAndUpdate(
              newPrinter._id,
              { $inc: { currentLoad: totalPages, jobsInQueue: 1 } },
              { new: true }
            );
            if (updatedNewPrinter) {
              emitToShop(order.shop.toString(), 'printer:status_update', { printers: [updatedNewPrinter] });
            }

            // Notify print agent with full routing info
            const { printViaIpp } = require('../services/ippPrint.service');
            const Printer = require('../models/Printer');
            const p = await Printer.findById(order.assignedPrinter);
            if (p) printViaIpp(order, p).catch(err => console.error(err.message));

            logger.info(`Order ${order.orderNumber} reassigned from offline printer ${offlinePrinter.name} to ${order.assignedPrinterName} (${order.assignedPrinterSystemName})`);
          }
        } catch (err) {
          logger.warn(`Failed to reassign order ${order.orderNumber}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    logger.error('Reassign offline printer jobs cron error:', err);
  }
}, { scheduled: false });

/**
 * FIX #1: Cleanup orphaned S3 uploads — runs every 30 minutes
 *
 * Files uploaded via /api/upload but never attached to an order
 * (network drop, browser close, etc.) are tracked in the PendingUpload
 * collection with status 'pending'. When an order is created the records
 * are flipped to 'claimed'.
 *
 * This cron finds all 'pending' PendingUpload records whose expiresAt has
 * passed, deletes the corresponding S3 objects, then removes the records.
 *
 * The MongoDB TTL index on expiresAt handles 'claimed' record cleanup
 * automatically — no extra work needed here.
 */
const cleanupOrphanedUploads = cron.schedule('*/30 * * * *', async () => {
  // Distributed lock: 29 min TTL
  if (!(await acquireLock('cleanupOrphanedUploads', 29 * 60 * 1000))) return;
  try {
    const PendingUpload = require('../models/PendingUpload');
    const { deleteFile } = require('../config/aws');
    const now = new Date();

    // Find all pending (unclaimed) uploads whose TTL has expired
    const orphans = await PendingUpload.find({
      status: 'pending',
      expiresAt: { $lt: now },
    }).lean();

    if (orphans.length === 0) {
      logger.info('Orphaned upload cleanup: nothing to delete');
      return;
    }

    let deleted = 0;
    const failedKeys = [];

    for (const record of orphans) {
      try {
        await deleteFile(record.s3Key);
        deleted++;
      } catch (err) {
        // S3 key may already be gone — log and continue
        logger.warn(`Orphan S3 delete failed for ${record.s3Key}: ${err.message}`);
        failedKeys.push(record.s3Key);
      }
    }

    // Remove all processed records (including ones where S3 delete failed —
    // the file is either gone or inaccessible; either way the record is stale)
    const ids = orphans.map(o => o._id);
    await PendingUpload.deleteMany({ _id: { $in: ids } });

    logger.info(`Orphaned upload cleanup: deleted ${deleted}/${orphans.length} S3 file(s)${failedKeys.length ? `, ${failedKeys.length} S3 delete(s) failed (records still removed)` : ''}`);
  } catch (err) {
    logger.error('Orphaned upload cleanup cron error:', err);
  }
}, { scheduled: false });

/**
 * FIX #4: Re-emit accepted orders with idle print jobs — runs every 5 minutes
 *
 * If autoDispatchToPrinter fires but the print agent is not yet connected,
 * the order stays in 'accepted' with printJob.status 'idle' indefinitely.
 * The agent replay on join:agent handles reconnects, but if the agent is
 * already connected and missed the event (e.g. brief disconnect), this cron
 * re-emits order:accepted for any such stale orders.
 */
const reEmitStaleAcceptedOrders = cron.schedule('*/5 * * * *', async () => {
  // Distributed lock: 4 min TTL
  if (!(await acquireLock('reEmitStaleAcceptedOrders', 4 * 60 * 1000))) return;
  try {
    const { getIO } = require('../config/socket');
const fiveMinutesAgo = moment().subtract(5, 'minutes').toDate();

    const staleOrders = await Order.find({
      status: 'accepted',
      'printJob.status': { $in: ['idle', null] },
      updatedAt: { $lt: fiveMinutesAgo },
    }).select('_id orderNumber shop documents assignedPrinterName').lean();

    for (const order of staleOrders) {
      const shopId = order.shop.toString();

      // Only re-emit if an agent is actually connected for this shop
      let io;
      try { io = getIO(); } catch { break; }
      const agentRoom = io.sockets.adapter.rooms.get(`agent:${shopId}`);
      if (!agentRoom || agentRoom.size === 0) continue; // agent not connected — skip

      const { printViaIpp } = require('../services/ippPrint.service');
      const Printer = require('../models/Printer');
      const p = await Printer.findById(order.assignedPrinter);
      if (p) printViaIpp(order, p).catch(err => console.error(err.message));

      logger.info(`Re-emitted stale accepted order ${order.orderNumber} to agent:${shopId}`);
    }
  } catch (err) {
    logger.error('Re-emit stale accepted orders cron error:', err);
  }
}, { scheduled: false });

/**
 * Start all cron jobs

/**
 * Queue Health Check — run every 5 minutes
 * Monitors incomplete order counts and alerts on accumulation
 */
const checkQueueHealth = cron.schedule('*/5 * * * *', async () => {
  // Distributed lock: 4 min TTL (slightly less than interval)
  if (!(await acquireLock('checkQueueHealth', 4 * 60 * 1000))) return;
  try {
    const Shop = require('../models/Shop');
    const shops = await Shop.find({ isActive: true }).select('_id name');
    
    for (const shop of shops) {
      const incompletCount = await Order.countDocuments({
        shop: shop._id,
        status: { $in: ['accepted', 'printing', 'queued'] },
      });
      
      // Log metrics at different thresholds
      if (incompletCount > 500) {
        logger.error(`🚨 CRITICAL: Shop "${shop.name}" queue depth critical: ${incompletCount} orders`);
        // TODO: Send admin alert email/Slack
      } else if (incompletCount > 200) {
        logger.warn(`⚠️  Shop "${shop.name}" has ${incompletCount} incomplete orders`);
      } else if (incompletCount > 50) {
        logger.info(`📊 Shop "${shop.name}" queue depth: ${incompletCount} orders`);
      }
    }
  } catch (err) {
    logger.error(`Queue health check failed: ${err.message}`);
  }
});

/**
 * Retry failed Razorpay webhooks — every 10 minutes
 */
const retryWebhooks = cron.schedule('*/10 * * * *', async () => {
  if (!(await acquireLock('retryWebhooks', 9 * 60 * 1000))) return;
  try {
    const { retryFailedWebhooks } = require('../services/webhookMonitor.service');
    await retryFailedWebhooks();
  } catch (err) {
    logger.error(`Webhook retry cron failed: ${err.message}`);
  }
});

const startCronJobs = () => {
  checkExpiringOrders.start();
  expireOrders.start();
  cleanupOldFiles.start();
  archiveOneMonthOldOrders.start();
  expirePendingPayments.start();
  // autoHideOldOrders.start(); // Disabled: keep all orders visible
  autoRetryIncompleteJobs.start();
  // markStalePrintersOffline.start(); // Disabled: No longer using print agent heartbeats
  reassignOfflinePrinterJobs.start();
  cleanupOrphanedUploads.start();    // FIX #1: orphaned S3 uploads
  reEmitStaleAcceptedOrders.start(); // FIX #4: stale accepted orders
  checkQueueHealth.start();           // NEW: queue health monitoring
  retryWebhooks.start();
  logger.info('Cron jobs started: expiry alerts (30min), order expiry (15min), S3 cleanup (daily 2am), 1-month archival (daily 3am), pending payment expiry (30min), auto-hide orders (hourly), auto-retry incomplete (15min), mark stale offline (5min), reassign offline jobs (10min), orphaned upload cleanup (30min), re-emit stale accepted (5min), queue health check (5min), webhook retry (10min)');
};

const stopCronJobs = () => {
  checkExpiringOrders.stop();
  expireOrders.stop();
  cleanupOldFiles.stop();
  archiveOneMonthOldOrders.stop();
  expirePendingPayments.stop();
  autoHideOldOrders.stop();
  autoRetryIncompleteJobs.stop();
  // markStalePrintersOffline.stop();
  reassignOfflinePrinterJobs.stop();
  cleanupOrphanedUploads.stop();    // FIX #1
  reEmitStaleAcceptedOrders.stop(); // FIX #4
  checkQueueHealth.stop();           // NEW
  retryWebhooks.stop();
};

module.exports = { startCronJobs, stopCronJobs };
