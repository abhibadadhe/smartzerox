/**
 * Reset all printers in database
 * Usage: node resetPrinters.js
 */

require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const Printer = require('../models/Printer');

async function resetPrinters() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smartxerox');
    console.log('✅ Connected to MongoDB');

    // Delete all printers
    const result = await Printer.deleteMany({});
    console.log(`🗑️  Deleted ${result.deletedCount} printers from database`);

    // Show remaining printers
    const remaining = await Printer.countDocuments();
    console.log(`📊 Remaining printers in database: ${remaining}`);

    console.log('✅ Reset complete!');
    console.log('\nNext steps:');
    console.log('1. Restart the Print Agent');
    console.log('2. Agent will detect only physically connected printers');
    console.log('3. Refresh the website to see updated printer list');

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

resetPrinters();
