/**
 * Migration Script: Add Explicit Print Settings to Existing Orders
 * 
 * This script updates all existing orders in the database to have explicit
 * colorMode and sides values for each printing range, preventing validation
 * errors after deploying the edge case fixes.
 * 
 * IMPORTANT: Run this BEFORE deploying the backend with new validation rules.
 * 
 * Usage:
 *   node scripts/migrateOrderPrintSettings.js
 * 
 * Environment Variables Required:
 *   MONGODB_URI - MongoDB connection string
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/smart-xerox';

// Statistics
const stats = {
  totalOrders: 0,
  ordersWithMissingSettings: 0,
  rangesFixed: 0,
  errors: 0,
  skipped: 0
};

async function connectDatabase() {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
}

async function migrateOrders() {
  try {
    const Order = mongoose.model('Order');
    
    // Find all orders (including completed/cancelled - for historical accuracy)
    const orders = await Order.find({}).lean();
    stats.totalOrders = orders.length;
    
    console.log(`\n📊 Found ${stats.totalOrders} orders to check\n`);
    
    const bulkOperations = [];
    
    for (const order of orders) {
      let needsUpdate = false;
      const updates = {};
      
      if (!order.documents || order.documents.length === 0) {
        stats.skipped++;
        continue;
      }
      
      order.documents.forEach((doc, docIndex) => {
        if (!doc.printingRanges || doc.printingRanges.length === 0) {
          // Document has no printing ranges - add default range
          needsUpdate = true;
          updates[`documents.${docIndex}.printingRanges`] = [{
            rangeStart: 1,
            rangeEnd: doc.detectedPages || 1,
            copies: 1,
            colorMode: 'bw',  // Safe default for existing orders
            sides: 'single',  // Safe default for existing orders
            pagesPerSheet: 1
          }];
          stats.rangesFixed++;
        } else {
          // Check each printing range
          doc.printingRanges.forEach((range, rangeIndex) => {
            // Fix missing colorMode
            if (!range.colorMode || !['bw', 'color'].includes(range.colorMode)) {
              needsUpdate = true;
              updates[`documents.${docIndex}.printingRanges.${rangeIndex}.colorMode`] = 'bw';
              stats.rangesFixed++;
            }
            
            // Fix missing sides
            if (!range.sides || !['single', 'double'].includes(range.sides)) {
              needsUpdate = true;
              updates[`documents.${docIndex}.printingRanges.${rangeIndex}.sides`] = 'single';
              stats.rangesFixed++;
            }
          });
        }
      });
      
      if (needsUpdate) {
        stats.ordersWithMissingSettings++;
        bulkOperations.push({
          updateOne: {
            filter: { _id: order._id },
            update: { $set: updates }
          }
        });
      }
    }
    
    // Execute bulk update
    if (bulkOperations.length > 0) {
      console.log(`🔧 Updating ${bulkOperations.length} orders with missing print settings...\n`);
      
      const result = await Order.bulkWrite(bulkOperations);
      
      console.log(`✅ Migration completed successfully!\n`);
      console.log(`📊 Statistics:`);
      console.log(`   Total Orders Checked: ${stats.totalOrders}`);
      console.log(`   Orders Updated: ${result.modifiedCount}`);
      console.log(`   Ranges Fixed: ${stats.rangesFixed}`);
      console.log(`   Orders Skipped: ${stats.skipped}`);
      console.log(`   Errors: ${stats.errors}\n`);
    } else {
      console.log(`✅ All orders already have explicit print settings. No migration needed.\n`);
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    stats.errors++;
    throw error;
  }
}

async function verifyMigration() {
  try {
    const Order = mongoose.model('Order');
    
    // Check for any orders with missing settings
    const ordersWithMissingColorMode = await Order.countDocuments({
      'documents.printingRanges.colorMode': { $exists: false }
    });
    
    const ordersWithMissingSides = await Order.countDocuments({
      'documents.printingRanges.sides': { $exists: false }
    });
    
    console.log(`🔍 Verification Results:`);
    console.log(`   Orders missing colorMode: ${ordersWithMissingColorMode}`);
    console.log(`   Orders missing sides: ${ordersWithMissingSides}\n`);
    
    if (ordersWithMissingColorMode === 0 && ordersWithMissingSides === 0) {
      console.log(`✅ VERIFICATION PASSED: All orders have explicit print settings\n`);
      return true;
    } else {
      console.log(`⚠️ VERIFICATION FAILED: Some orders still have missing settings\n`);
      return false;
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
    return false;
  }
}

async function generateReport() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`MIGRATION REPORT - ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);
  
  console.log(`Database: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);
  console.log(`Total Orders: ${stats.totalOrders}`);
  console.log(`Orders Updated: ${stats.ordersWithMissingSettings}`);
  console.log(`Ranges Fixed: ${stats.rangesFixed}`);
  console.log(`Orders Skipped: ${stats.skipped}`);
  console.log(`Errors: ${stats.errors}\n`);
  
  if (stats.errors === 0 && stats.ordersWithMissingSettings > 0) {
    console.log(`✅ Migration successful! Database is ready for new validation rules.`);
  } else if (stats.errors === 0 && stats.ordersWithMissingSettings === 0) {
    console.log(`ℹ️ No migration needed. All orders already have explicit settings.`);
  } else {
    console.log(`⚠️ Migration completed with errors. Please review logs.`);
  }
  
  console.log(`\n${'='.repeat(60)}\n`);
}

// Dry run mode for testing
async function dryRun() {
  try {
    const Order = mongoose.model('Order');
    const orders = await Order.find({}).lean();
    
    console.log(`\n🔍 DRY RUN MODE - No changes will be made\n`);
    
    let ordersNeedingUpdate = 0;
    let rangesNeedingFix = 0;
    
    for (const order of orders) {
      let orderNeedsUpdate = false;
      
      if (!order.documents || order.documents.length === 0) continue;
      
      for (const doc of order.documents) {
        if (!doc.printingRanges || doc.printingRanges.length === 0) {
          orderNeedsUpdate = true;
          rangesNeedingFix++;
          console.log(`Order ${order.orderNumber || order._id}: Document missing printingRanges`);
          continue;
        }
        
        for (const range of doc.printingRanges) {
          if (!range.colorMode || !['bw', 'color'].includes(range.colorMode)) {
            orderNeedsUpdate = true;
            rangesNeedingFix++;
            console.log(`Order ${order.orderNumber || order._id}: Range missing/invalid colorMode`);
          }
          
          if (!range.sides || !['single', 'double'].includes(range.sides)) {
            orderNeedsUpdate = true;
            rangesNeedingFix++;
            console.log(`Order ${order.orderNumber || order._id}: Range missing/invalid sides`);
          }
        }
      }
      
      if (orderNeedsUpdate) ordersNeedingUpdate++;
    }
    
    console.log(`\n📊 Dry Run Results:`);
    console.log(`   Total Orders: ${orders.length}`);
    console.log(`   Orders Needing Update: ${ordersNeedingUpdate}`);
    console.log(`   Ranges Needing Fix: ${rangesNeedingFix}\n`);
    
  } catch (error) {
    console.error('❌ Dry run failed:', error);
  }
}

// Main execution
async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const skipVerification = process.argv.includes('--skip-verification');
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`PRINT SETTINGS MIGRATION SCRIPT`);
  console.log(`${'='.repeat(60)}\n`);
  
  if (isDryRun) {
    console.log(`⚠️ Running in DRY RUN mode - no changes will be made\n`);
  }
  
  try {
    await connectDatabase();
    
    if (isDryRun) {
      await dryRun();
    } else {
      await migrateOrders();
      
      if (!skipVerification) {
        const verificationPassed = await verifyMigration();
        if (!verificationPassed) {
          console.log(`⚠️ Consider running the migration again or checking logs.`);
        }
      }
      
      await generateReport();
    }
    
  } catch (error) {
    console.error(`\n❌ Fatal error:`, error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log(`\n✅ Disconnected from MongoDB\n`);
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log(`\n\n⚠️ Migration interrupted by user`);
  await mongoose.disconnect();
  process.exit(0);
});

// Run migration
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
