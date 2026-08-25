/**
 * Script to delete ALL orders (clean slate for fresh start)
 * Run: node scripts/cleanTestOrders.js  (from backend folder)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Payment = require('../models/Payment');

async function cleanAllOrders() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const allOrders = await Order.find({}).select('orderNumber status');
  console.log('Orders found:');
  allOrders.forEach(function(o) {
    console.log('  #' + o.orderNumber + ' | ' + o.status);
  });

  // Delete all orders and payments
  const ordersDeleted = await Order.deleteMany({});
  const paymentsDeleted = await Payment.deleteMany({});

  console.log('Deleted ' + ordersDeleted.deletedCount + ' orders');
  console.log('Deleted ' + paymentsDeleted.deletedCount + ' payments');

  await mongoose.disconnect();
  console.log('Done! Fresh start — next order will be #1');
}

cleanAllOrders().catch(function(err) {
  console.error('Error:', err.message);
  process.exit(1);
});
