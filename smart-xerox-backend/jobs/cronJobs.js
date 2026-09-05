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
  if (!order || !order.documents) return 0;
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
 * Check for orders expiring soon (30-min alert) — runs every 30 minutes
 */
const checkExpiringOrders = cron.schedule('*/30 * * * *', async () => {
  if (!(await acquireLock('checkExpiringOrders', 29 * 60 * 1000))) return;
  try {
    const thirtyMinutesFromNow = moment().add(30, 'minutes').toDate();
    const now = new Date();

    const orders = await Order.find({
      status: 'ready',
      'expiry.expiresAt': { $gt: now, $lte: thirtyMinutesFromNow },
      'expiry.notified30Min': { $ne: true },
    }).populate('user', 'name email phone');

    for (const order of orders) {
      if (order.user) {
        await createNotification({
          recipient: order.user._id,
          type: 'order_expiring_soon',
          title: 'Order Expiring Soon!',
          message: `Order #${order.orderNumber} will expire in 30 minutes. Please pick it up from the shop.`,
          order: order._id,
          priority: 'high',
        });
      }
      order.expiry.notified30Min = true;
      await order.save({ validateBeforeSave: false });
    }
  } catch (err) {
    logger.error('Check expiring orders cron error:', err);
  }
}, { scheduled: false });

/**
 * Expire uncollected ready orders after pickup window — runs every 15 minutes
 */
const expireOrders = cron.schedule('*/15 * * * *', async () => {
  if (!(await acquireLock('expireOrders', 14 * 60 * 1000))) return;
  try {
    const now = new Date();
    const expiredOrders = await Order.find({
      status: 'ready',
      'expiry.expiresAt': { $lte: now },
    });

    for (const order of expiredOrders) {
      order.status = 'expired';
      order.statusHistory.push({
        status: 'expired',
        note: 'Order expired: Not picked up within the allowed pickup window',
        timestamp: new Date(),
      });
      await order.save({ validateBeforeSave: false });

      emitToUser(order.user?.toString(), 'order:expired', { orderId: order._id, orderNumber: order.orderNumber });
      emitToShop(order.shop?.toString(), 'order:expired', { orderId: order._id, orderNumber: order.orderNumber });
    }

    if (expiredOrders.length > 0) {
      logger.info(`Expired ${expiredOrders.length} uncollected ready orders`);
    }
  } catch (err) {
    logger.error('Order expiry cron error:', err);
  }
}, { scheduled: false });

/**
 * Expire pending payments older than 12 hours - run every 30 minutes
 */
const expirePendingPayments = cron.schedule('*/30 * * * *', async () => {
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
      await order.save({ validateBeforeSave: false });
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
 * 5-Day Order Document Data & Storage Archival
 * 
 * Automatically deletes heavy PDF/DOCX/image files from storage after 5 days for free storage
 * while 100% preserving all financial revenue data (pricing totals, payments, shop receivable, settlements, order numbers).
 */
const runFiveDayArchival = async () => {
  try {
    const fiveDaysAgo = moment().subtract(5, 'days').toDate();
    
    const oldOrders = await Order.find({
      createdAt: { $lt: fiveDaysAgo },
      dataArchived: { $ne: true }
    });

    let count = 0;
    for (const order of oldOrders) {
      await deleteOrderS3Files(order);

      order.documents = (order.documents || []).map(doc => ({
        _id: doc._id,
        originalName: doc.originalName || 'Archived Document',
        pageCount: doc.pageCount || 0,
        detectedPages: doc.detectedPages || 0,
        s3Key: null,
        s3Url: null,
        printingRanges: doc.printingRanges || []
      }));

      order.dataArchived = true;
      order.archivedAt = new Date();

      await order.save({ validateBeforeSave: false });
      count++;
    }

    const KitOrder = require('../modules/kit/kit.model');
    const oldKitOrders = await KitOrder.find({
      createdAt: { $lt: fiveDaysAgo },
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
      logger.info(`📦 5-Day Archival: Deleted file storage for ${count} order(s) and ${kitCount} kit order(s) (>5 days old) while 100% preserving all revenue & payment records.`);
    }
  } catch (err) {
    logger.error('5-Day order archival error:', err);
  }
};

const archiveFiveDayOldOrders = cron.schedule('0 3 * * *', async () => {
  if (!(await acquireLock('archiveFiveDayOldOrders', 55 * 60 * 1000))) return;
  await runFiveDayArchival();
}, { scheduled: false });


/**
 * Auto-retry incomplete print jobs after 30 minutes — runs every 15 minutes
 */
const autoRetryIncompleteJobs = cron.schedule('*/15 * * * *', async () => {
  if (!(await acquireLock('autoRetryIncompleteJobs', 14 * 60 * 1000))) return;
  try {
    const thirtyMinutesAgo = moment().subtract(30, 'minutes').toDate();
    const incompleteJobs = await Order.find({
      'printJob.status': 'incomplete',
      'printJob.verificationFailed': true,
      updatedAt: { $lt: thirtyMinutesAgo },
      'printJob.retryCount': { $lt: 3 },
    }).select('_id orderNumber shop printJob');

    for (const order of incompleteJobs) {
      order.printJob.status = 'queued';
      order.printJob.verificationFailed = false;
      order.printJob.retryCount = (order.printJob.retryCount || 0) + 1;
      order.printJob.lastRetryAt = new Date();
      await order.save({ validateBeforeSave: false });
    }
  } catch (err) {
    logger.error('Auto-retry incomplete jobs cron error:', err);
  }
}, { scheduled: false });

/**
 * Reassign offline printer jobs — runs every 10 minutes
 */
const reassignOfflinePrinterJobs = cron.schedule('*/10 * * * *', async () => {
  if (!(await acquireLock('reassignOfflinePrinterJobs', 9 * 60 * 1000))) return;
  try {
    const { reassignPendingJobsForOfflinePrinters } = require('../services/printerLoadBalancer');
    await reassignPendingJobsForOfflinePrinters();
  } catch (err) {
    logger.error('Offline printer reassignment cron error:', err);
  }
}, { scheduled: false });

/**
 * Cleanup orphaned uploads — runs every 30 minutes
 */
const cleanupOrphanedUploads = cron.schedule('*/30 * * * *', async () => {
  if (!(await acquireLock('cleanupOrphanedUploads', 29 * 60 * 1000))) return;
  try {
    const { cleanupOrphanedUploads: runCleanup } = require('../services/s3Cleanup.service');
    await runCleanup();
  } catch (err) {
    logger.error('Orphaned upload cleanup cron error:', err);
  }
}, { scheduled: false });

/**
 * Re-emit stale accepted orders — runs every 5 minutes
 */
const reEmitStaleAcceptedOrders = cron.schedule('*/5 * * * *', async () => {
  if (!(await acquireLock('reEmitStaleAcceptedOrders', 4 * 60 * 1000))) return;
  try {
    const tenMinutesAgo = moment().subtract(10, 'minutes').toDate();
    const staleOrders = await Order.find({
      status: { $in: ['paid', 'accepted', 'queued'] },
      'printJob.status': { $in: ['pending', 'queued'] },
      updatedAt: { $lt: tenMinutesAgo },
    }).limit(20);

    for (const order of staleOrders) {
      emitToShop(order.shop?.toString(), 'order:new', order);
    }
  } catch (err) {
    logger.error('Re-emit stale accepted orders cron error:', err);
  }
}, { scheduled: false });

/**
 * Check queue health — runs every 5 minutes
 */
const checkQueueHealth = cron.schedule('*/5 * * * *', async () => {
  if (!(await acquireLock('checkQueueHealth', 4 * 60 * 1000))) return;
  try {
    const Shop = require('../models/Shop');
    const shops = await Shop.find({ isActive: true }).select('_id name');
    for (const shop of shops) {
      const count = await Order.countDocuments({
        shop: shop._id,
        status: { $in: ['accepted', 'printing', 'queued'] },
      });
      if (count > 200) {
        logger.warn(`⚠️ Shop "${shop.name}" has ${count} incomplete orders in queue`);
      }
    }
  } catch (err) {
    logger.error('Queue health check failed:', err);
  }
}, { scheduled: false });

/**
 * Retry failed Razorpay webhooks — every 10 minutes
 */
const retryWebhooks = cron.schedule('*/10 * * * *', async () => {
  if (!(await acquireLock('retryWebhooks', 9 * 60 * 1000))) return;
  try {
    const { retryFailedWebhooks } = require('../services/webhookMonitor.service');
    await retryFailedWebhooks();
  } catch (err) {
    logger.error('Webhook retry cron error:', err);
  }
}, { scheduled: false });

const startCronJobs = () => {
  checkExpiringOrders.start();
  expireOrders.start();
  archiveFiveDayOldOrders.start();
  expirePendingPayments.start();
  autoRetryIncompleteJobs.start();
  reassignOfflinePrinterJobs.start();
  cleanupOrphanedUploads.start();
  reEmitStaleAcceptedOrders.start();
  checkQueueHealth.start();
  retryWebhooks.start();
  logger.info('Cron jobs started: expiry alerts (30min), order expiry (15min), 5-day storage archival (daily 3am + startup), pending payment expiry (30min), auto-retry incomplete (15min), reassign offline jobs (10min), orphaned upload cleanup (30min), re-emit stale accepted (5min), queue health check (5min), webhook retry (10min)');
  
  // Run initial 5-day storage cleanup on boot
  runFiveDayArchival().catch(err => logger.error('Initial 5-day archival on boot error:', err));
};


const stopCronJobs = () => {
  checkExpiringOrders.stop();
  expireOrders.stop();
  archiveFiveDayOldOrders.stop();
  expirePendingPayments.stop();
  autoRetryIncompleteJobs.stop();
  reassignOfflinePrinterJobs.stop();
  cleanupOrphanedUploads.stop();
  reEmitStaleAcceptedOrders.stop();
  checkQueueHealth.stop();
  retryWebhooks.stop();
};

module.exports = { startCronJobs, stopCronJobs };
