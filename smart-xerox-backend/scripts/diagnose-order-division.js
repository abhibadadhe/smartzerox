/**
 * Diagnostic Script: Check Order Division Configuration
 * 
 * This script checks:
 * 1. If order division is enabled in PlatformSettings
 * 2. If printers have correct types
 * 3. If recent orders were divided correctly
 * 
 * Usage: node scripts/diagnose-order-division.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const PlatformSettings = require('../models/PlatformSettings');
const Printer = require('../models/Printer');
const Order = require('../models/Order');

async function diagnose() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // ── Check 1: Platform Settings ──────────────────────────────────────────
    console.log('📋 STEP 1: Checking Platform Settings...\n');
    const settings = await PlatformSettings.getSettings();
    
    console.log('Order Division Settings:');
    console.log(`  enabled: ${settings.orderDivision?.enabled ?? 'NOT SET (default: true)'}`);
    console.log(`  autoSplitMixedColorOrders: ${settings.orderDivision?.autoSplitMixedColorOrders ?? 'NOT SET (default: true)'}`);
    console.log('');
    
    console.log('Printer Assignment Settings:');
    console.log(`  strategy: ${settings.printerAssignment?.strategy ?? 'NOT SET (default: strict_type_match)'}`);
    console.log(`  allowColorPrinterForBW: ${settings.printerAssignment?.allowColorPrinterForBW ?? 'NOT SET (default: false)'}`);
    console.log(`  allowBWPrinterForColor: ${settings.printerAssignment?.allowBWPrinterForColor ?? 'NOT SET (default: false)'}`);
    console.log('');

    if (!settings.orderDivision?.enabled) {
      console.log('⚠️  WARNING: Order division is DISABLED!');
      console.log('   Mixed color/B&W orders will NOT be split automatically.\n');
    } else {
      console.log('✅ Order division is ENABLED\n');
    }

    // ── Check 2: Printers ───────────────────────────────────────────────────
    console.log('📋 STEP 2: Checking Printers...\n');
    const printers = await Printer.find({}).populate('shop', 'name');
    
    if (printers.length === 0) {
      console.log('❌ No printers found in database!\n');
    } else {
      console.log(`Found ${printers.length} printer(s):\n`);
      
      const colorPrinters = printers.filter(p => p.type === 'color');
      const bwPrinters = printers.filter(p => p.type === 'bw');
      const unknownPrinters = printers.filter(p => !p.type || (p.type !== 'color' && p.type !== 'bw'));
      
      console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ Display Name          │ Type    │ Status    │ Enabled │ Shop              │');
      console.log('├─────────────────────────────────────────────────────────────────────────────┤');
      
      printers.forEach(p => {
        const displayName = (p.displayName || p.name || 'Unknown').padEnd(20).substring(0, 20);
        const type = (p.type || 'UNKNOWN').padEnd(7);
        const status = (p.status || 'unknown').padEnd(9);
        const enabled = (p.isEnabled ? 'Yes' : 'No').padEnd(7);
        const shop = (p.shop?.name || 'Unknown').padEnd(16).substring(0, 16);
        
        console.log(`│ ${displayName} │ ${type} │ ${status} │ ${enabled} │ ${shop} │`);
      });
      
      console.log('└─────────────────────────────────────────────────────────────────────────────┘\n');
      
      console.log('Summary:');
      console.log(`  🌈 Color Printers: ${colorPrinters.length}`);
      console.log(`  ⬛ B&W Printers: ${bwPrinters.length}`);
      console.log(`  ❓ Unknown Type: ${unknownPrinters.length}\n`);
      
      if (unknownPrinters.length > 0) {
        console.log('⚠️  WARNING: Some printers have unknown type!');
        console.log('   Run: node scripts/update-printer-names.js\n');
      }
      
      if (colorPrinters.length === 0) {
        console.log('⚠️  WARNING: No color printers found!');
        console.log('   Color orders cannot be printed.\n');
      }
      
      if (bwPrinters.length === 0) {
        console.log('⚠️  WARNING: No B&W printers found!');
        console.log('   B&W orders cannot be printed.\n');
      }
      
      if (colorPrinters.length > 0 && bwPrinters.length > 0) {
        console.log('✅ Good! You have both color and B&W printers.\n');
      }
    }

    // ── Check 3: Recent Orders ──────────────────────────────────────────────
    console.log('📋 STEP 3: Checking Recent Orders...\n');
    const recentOrders = await Order.find({ 
      status: { $ne: 'pending_payment' } 
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('assignedPrinter', 'displayName name type')
      .lean();
    
    if (recentOrders.length === 0) {
      console.log('No orders found.\n');
    } else {
      console.log(`Found ${recentOrders.length} recent order(s):\n`);
      
      recentOrders.forEach(order => {
        console.log(`Order #${order.orderNumber || 'N/A'}:`);
        console.log(`  Status: ${order.status}`);
        console.log(`  Color Mode: ${order.colorMode || 'not set'}`);
        console.log(`  Is Divided: ${order.isDivided ? 'Yes' : 'No'}`);
        
        if (order.isDivided) {
          console.log(`  Sub-Orders: ${order.subOrders?.length || 0}`);
        }
        
        if (order.assignedPrinter) {
          console.log(`  Assigned Printer: ${order.assignedPrinter.displayName || order.assignedPrinter.name} (${order.assignedPrinter.type})`);
        } else {
          console.log(`  Assigned Printer: None`);
        }
        
        // Analyze documents
        let hasColor = false;
        let hasBW = false;
        let totalPages = 0;
        
        order.documents?.forEach(doc => {
          doc.printingRanges?.forEach(range => {
            const pages = (range.rangeEnd - range.rangeStart + 1) * (range.copies || 1);
            totalPages += pages;
            
            if (range.colorMode === 'color') {
              hasColor = true;
            } else {
              hasBW = true;
            }
          });
        });
        
        console.log(`  Pages: ${totalPages} (Color: ${hasColor ? 'Yes' : 'No'}, B&W: ${hasBW ? 'Yes' : 'No'})`);
        
        // Check for issues
        if (hasColor && hasBW && !order.isDivided) {
          console.log(`  ⚠️  ISSUE: Mixed color/B&W order was NOT divided!`);
        }
        
        if (hasBW && !hasColor && order.assignedPrinter?.type === 'color') {
          console.log(`  ⚠️  ISSUE: B&W order assigned to color printer!`);
        }
        
        if (hasColor && !hasBW && order.assignedPrinter?.type === 'bw') {
          console.log(`  ⚠️  ISSUE: Color order assigned to B&W printer!`);
        }
        
        console.log('');
      });
    }

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('DIAGNOSIS COMPLETE\n');
    
    const issues = [];
    
    if (!settings.orderDivision?.enabled) {
      issues.push('Order division is disabled');
    }
    
    const printerCheck = await Printer.find({});
    const hasColor = printerCheck.some(p => p.type === 'color' && p.isEnabled);
    const hasBW = printerCheck.some(p => p.type === 'bw' && p.isEnabled);
    
    if (!hasColor) {
      issues.push('No enabled color printers');
    }
    
    if (!hasBW) {
      issues.push('No enabled B&W printers');
    }
    
    if (printerCheck.some(p => !p.type || (p.type !== 'color' && p.type !== 'bw'))) {
      issues.push('Some printers have unknown type');
    }
    
    if (issues.length > 0) {
      console.log('❌ ISSUES FOUND:');
      issues.forEach(issue => console.log(`   - ${issue}`));
      console.log('');
    } else {
      console.log('✅ No issues found! System should work correctly.\n');
    }
    
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

diagnose();
