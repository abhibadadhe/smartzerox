/**
 * Script to list all orders
 * Usage: node scripts/listOrders.js [shopId]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Shop = require('../models/Shop');

const listOrders = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smartxerox');
    console.log('✅ Connected to database\n');

    const shopId = process.argv[2];

    let query = {};
    if (shopId) {
      query = { shop: shopId };
      const shop = await Shop.findById(shopId);
      if (shop) {
        console.log(`📍 Shop: ${shop.name}`);
        console.log(`   ID: ${shop._id}\n`);
      }
    }

    // Get all orders
    const orders = await Order.find(query)
      .populate('shop', 'name')
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    if (orders.length === 0) {
      console.log('❌ No orders found');
      process.exit(0);
    }

    console.log(`📋 Total Orders: ${orders.length}\n`);
    console.log('┌─────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ # │ Order │ User              │ Shop              │ Status      │ Amount │ Date   │');
    console.log('├─────────────────────────────────────────────────────────────────────────────────┤');

    orders.forEach((order, idx) => {
      const orderNum = order.orderNumber.padEnd(5);
      const user = (order.user?.name || 'N/A').substring(0, 15).padEnd(15);
      const shop = (order.shop?.name || 'N/A').substring(0, 15).padEnd(15);
      const status = order.status.padEnd(11);
      const amount = `₹${order.pricing?.total || 0}`.padEnd(6);
      const date = new Date(order.createdAt).toLocaleDateString('en-IN').padEnd(6);
      
      console.log(`│ ${(idx + 1).toString().padEnd(1)} │ ${orderNum} │ ${user} │ ${shop} │ ${status} │ ${amount} │ ${date} │`);
    });

    console.log('└─────────────────────────────────────────────────────────────────────────────────┘');

    console.log('\n💡 To delete an order, run:');
    console.log('   node scripts/deleteOrder.js <orderNumber>');
    console.log('\n   Example: node scripts/deleteOrder.js 1');

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
};

listOrders();
