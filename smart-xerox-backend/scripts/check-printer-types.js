#!/usr/bin/env node

/**
 * Diagnostic Script: Check Printer Types
 * 
 * This script checks if printers have the correct type field set.
 * If printers don't have the correct type, B&W routing won't work.
 */

const mongoose = require('mongoose');
const Printer = require('../models/Printer');
require('dotenv').config();

async function checkPrinterTypes() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/xerox-agent');
    console.log('✅ Connected to MongoDB\n');

    // Get all printers
    const printers = await Printer.find({}).lean();

    if (printers.length === 0) {
      console.log('❌ No printers found in database');
      process.exit(1);
    }

    console.log(`📊 Found ${printers.length} printers:\n`);
    console.log('┌─────────────────────────────────────────────────────────────────────┐');
    console.log('│ Printer Name                    │ Type    │ System Name             │');
    console.log('├─────────────────────────────────────────────────────────────────────┤');

    let colorCount = 0;
    let bwCount = 0;
    let unknownCount = 0;

    printers.forEach(p => {
      const name = (p.displayName || p.name || 'Unknown').substring(0, 30).padEnd(30);
      const type = (p.type || 'UNKNOWN').padEnd(7);
      const systemName = (p.systemName || '').substring(0, 23);

      console.log(`│ ${name} │ ${type} │ ${systemName} │`);

      if (p.type === 'color') colorCount++;
      else if (p.type === 'bw') bwCount++;
      else unknownCount++;
    });

    console.log('└─────────────────────────────────────────────────────────────────────┘\n');

    console.log(`Summary:`);
    console.log(`  🌈 Color Printers: ${colorCount}`);
    console.log(`  ⬛ B&W Printers: ${bwCount}`);
    console.log(`  ❓ Unknown Type: ${unknownCount}\n`);

    if (unknownCount > 0) {
      console.log('⚠️  WARNING: Some printers have unknown type!');
      console.log('   This will cause routing issues.\n');
      console.log('   Run: node scripts/update-printer-names.js\n');
    }

    if (colorCount === 0) {
      console.log('⚠️  WARNING: No color printers found!');
      console.log('   Color orders will be queued.\n');
    }

    if (bwCount === 0) {
      console.log('⚠️  WARNING: No B&W printers found!');
      console.log('   B&W orders will be queued.\n');
    }

    if (colorCount > 0 && bwCount > 0) {
      console.log('✅ Good! You have both color and B&W printers.');
      console.log('   Routing should work correctly.\n');
    }

    // Detailed printer info
    console.log('\n📋 Detailed Printer Information:\n');
    printers.forEach((p, i) => {
      console.log(`${i + 1}. ${p.displayName || p.name}`);
      console.log(`   Type: ${p.type || 'UNKNOWN'}`);
      console.log(`   System Name: ${p.systemName}`);
      console.log(`   Status: ${p.status}`);
      console.log(`   Enabled: ${p.isEnabled}`);
      console.log(`   Current Load: ${p.currentLoad} pages`);
      console.log(`   Jobs in Queue: ${p.jobsInQueue}`);
      console.log('');
    });

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

checkPrinterTypes();
