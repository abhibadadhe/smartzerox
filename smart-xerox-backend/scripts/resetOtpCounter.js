/**
 * Script to reset OTP counter for all shops to 0
 * Run: node scripts/resetOtpCounter.js  (from backend folder)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Shop = require('../models/Shop');

async function resetOtpCounters() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Reset all shops' otpCounter to 0
  const result = await Shop.updateMany({}, { $set: { otpCounter: 0 } });
  console.log('Reset otpCounter to 0 for ' + result.modifiedCount + ' shops');

  // Show current state
  const shops = await Shop.find({}).select('name otpCounter');
  shops.forEach(function(s) { console.log('  ' + s.name + ' -> otpCounter: ' + s.otpCounter); });

  await mongoose.disconnect();
  console.log('Done! Next order will get OTP = 1');
}

resetOtpCounters().catch(function(err) {
  console.error('Error:', err.message);
  process.exit(1);
});
