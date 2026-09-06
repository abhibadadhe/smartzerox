/**
 * Complete Order, Revenue, and Counter Reset Script
 * 
 * Preserves:
 * - User accounts (Users, Shopkeepers, Admins with login credentials)
 * - Shop profiles (Settings, pricing, addresses, Razorpay linked accounts)
 * - Printer setups (Configured printers, IP addresses, formats)
 * - System Settings & Announcements
 * 
 * Clears & Resets:
 * - All Orders & Order Numbers (Index starts at 1)
 * - All Kit Orders (OTP cycle starts at 1)
 * - All Revenue, Balances, Earnings & Payments
 * - All Withdrawals & Reviews
 * - All Order Notifications & Webhook logs
 * - All Shop & User order/revenue counters reset to 0
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (e) {}
const mongoose = require('mongoose');

const Order = require('../models/Order');
const Shop = require('../models/Shop');
const User = require('../models/User');
const Payment = require('../models/Payment');
const Withdrawal = require('../models/Withdrawal');
const Review = require('../models/Review');
const Notification = require('../models/Notification');
const PendingUpload = require('../models/PendingUpload');
const WebhookEvent = require('../models/WebhookEvent');
const Printer = require('../models/Printer');
const KitOrder = require('../modules/kit/kit.model');

async function resetAllData() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/smartxerox';
  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('Connected to MongoDB successfully.\n');

  console.log('----------------------------------------------------');
  console.log('STARTING DATABASE RESET (ORDERS, REVENUE, COUNTERS)');
  console.log('----------------------------------------------------');

  // 1. Delete all standard Orders
  const ordersDeleted = await Order.deleteMany({});
  console.log(`[Order] Deleted ${ordersDeleted.deletedCount} standard orders.`);

  // 2. Delete all Kit Orders
  const kitOrdersDeleted = await KitOrder.deleteMany({});
  console.log(`[KitOrder] Deleted ${kitOrdersDeleted.deletedCount} kit orders.`);

  // 3. Delete all Payment records
  const paymentsDeleted = await Payment.deleteMany({});
  console.log(`[Payment] Deleted ${paymentsDeleted.deletedCount} payment records.`);

  // 4. Delete all Withdrawal requests
  const withdrawalsDeleted = await Withdrawal.deleteMany({});
  console.log(`[Withdrawal] Deleted ${withdrawalsDeleted.deletedCount} withdrawal records.`);

  // 5. Delete all Reviews
  const reviewsDeleted = await Review.deleteMany({});
  console.log(`[Review] Deleted ${reviewsDeleted.deletedCount} reviews.`);

  // 6. Delete all Notifications
  const notificationsDeleted = await Notification.deleteMany({});
  console.log(`[Notification] Deleted ${notificationsDeleted.deletedCount} notifications.`);

  // 7. Delete all Pending Uploads
  const pendingUploadsDeleted = await PendingUpload.deleteMany({});
  console.log(`[PendingUpload] Deleted ${pendingUploadsDeleted.deletedCount} pending uploads.`);

  // 8. Delete all Webhook Events
  const webhooksDeleted = await WebhookEvent.deleteMany({});
  console.log(`[WebhookEvent] Deleted ${webhooksDeleted.deletedCount} webhook events.`);

  // 9. Reset Shop statistics and OTP counter to 0 (so next order starts at index 1)
  const shopUpdateResult = await Shop.updateMany({}, {
    $set: {
      otpCounter: 0,
      totalOrders: 0,
      totalRevenue: 0,
      availableBalance: 0,
      withdrawnAmount: 0,
      pendingOrdersCount: 0,
      rating: 0,
      totalRatings: 0,
    }
  });
  console.log(`[Shop] Reset counters & revenue for ${shopUpdateResult.modifiedCount} shop(s). Next order number / OTP = 1.`);

  // 10. Reset User order stats while preserving all accounts & credentials
  const userUpdateResult = await User.updateMany({}, {
    $set: {
      totalOrders: 0,
      totalSpent: 0,
    }
  });
  console.log(`[User] Preserved all user accounts. Reset stats for ${userUpdateResult.modifiedCount} user(s).`);

  // 11. Reset Printer queues & print counters
  const printerUpdateResult = await Printer.updateMany({}, {
    $set: {
      currentLoad: 0,
      jobsInQueue: 0,
      totalJobsProcessed: 0,
      totalPagesProcessed: 0,
      lastJobCompletedAt: null,
    }
  });
  console.log(`[Printer] Reset queues & metrics for ${printerUpdateResult.modifiedCount} printer(s).`);

  // 12. Display summary of preserved accounts & shops
  const totalUsers = await User.countDocuments();
  const totalShops = await Shop.countDocuments();
  const totalAdmins = await User.countDocuments({ role: 'admin' });
  const totalShopkeepers = await User.countDocuments({ role: 'shopkeeper' });
  const totalCustomers = await User.countDocuments({ role: 'user' });

  console.log('\n----------------------------------------------------');
  console.log('RESET COMPLETE SUMMARY:');
  console.log(`- Orders & Kit Orders: 0 (Next index = 1)`);
  console.log(`- Platform & Shop Revenue: Rs. 0`);
  console.log(`- Preserved Total Users: ${totalUsers} (Admins: ${totalAdmins}, Shopkeepers: ${totalShopkeepers}, Customers: ${totalCustomers})`);
  console.log(`- Preserved Total Shops: ${totalShops}`);
  console.log('----------------------------------------------------');

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB. Ready for fresh operations!');
}

resetAllData().catch((err) => {
  console.error('Fatal error during reset:', err);
  process.exit(1);
});
