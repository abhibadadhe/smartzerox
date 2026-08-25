/**
 * Script to delete an order by orderNumber
 * Usage: node scripts/deleteOrder.js <orderNumber>
 * Example: node scripts/deleteOrder.js 1
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../models/Order');

const deleteOrder = async () => {
  try {
    const orderNumber = process.argv[2];
    
    if (!orderNumber) {
      console.error('❌ Please provide an order number');
      console.log('Usage: node scripts/deleteOrder.js <orderNumber>');
      process.exit(1);
    }

    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smartxerox');
    console.log('✅ Connected to database');

    // Find and delete the order
    const result = await Order.findOneAndDelete({ orderNumber });

    if (!result) {
      console.log(`❌ Order #${orderNumber} not found`);
      process.exit(1);
    }

    console.log(`✅ Order #${orderNumber} deleted successfully`);
    console.log(`   Order ID: ${result._id}`);
    console.log(`   User: ${result.user}`);
    console.log(`   Shop: ${result.shop}`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Amount: ₹${result.pricing?.total}`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
};

deleteOrder();
