/**
 * Script to reset a shop's order counter
 * Usage: node scripts/resetOrderCounter.js <shopId>
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Shop = require('../models/Shop');

const resetCounter = async () => {
  try {
    const shopId = process.argv[2];
    
    if (!shopId) {
      console.error('❌ Please provide a shop ID');
      console.log('Usage: node scripts/resetOrderCounter.js <shopId>');
      process.exit(1);
    }

    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smartxerox');
    console.log('✅ Connected to database');

    // Find the shop
    const shop = await Shop.findById(shopId);
    if (!shop) {
      console.log(`❌ Shop not found: ${shopId}`);
      process.exit(1);
    }

    console.log(`\n📍 Shop: ${shop.name}`);
    console.log(`   Current Counter: ${shop.otpCounter}`);

    // Reset counter to 0
    const result = await Shop.findByIdAndUpdate(
      shopId,
      { otpCounter: 0 },
      { new: true }
    );

    console.log(`\n✅ Counter reset successfully`);
    console.log(`   New Counter: ${result.otpCounter}`);
    console.log(`   Next Order Number: 1`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
};

resetCounter();
