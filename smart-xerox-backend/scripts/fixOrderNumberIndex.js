/**
 * Migration Script: Fix orderNumber Index
 * 
 * Problem: The orderNumber field had a regular unique index that treats
 * all null values as duplicates, causing E11000 errors during order creation.
 * 
 * Solution: Drop the old index and create a partial unique index that allows
 * multiple null values (for orders pending payment) while enforcing uniqueness
 * for assigned order numbers (after payment success).
 * 
 * Run this script once to fix existing deployments:
 * node backend/scripts/fixOrderNumberIndex.js
 */

'use strict';

const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function fixOrderNumberIndex() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const ordersCollection = db.collection('orders');

    console.log('\n📋 Checking existing indexes on orders collection...');
    const existingIndexes = await ordersCollection.indexes();
    console.log('Current indexes:', existingIndexes.map(idx => idx.name).join(', '));

    // Drop the old orderNumber_1 index if it exists
    const oldIndexName = 'orderNumber_1';
    const hasOldIndex = existingIndexes.some(idx => idx.name === oldIndexName);
    
    if (hasOldIndex) {
      console.log(`\n🗑️  Dropping old index: ${oldIndexName}...`);
      await ordersCollection.dropIndex(oldIndexName);
      console.log('✅ Old index dropped successfully');
    } else {
      console.log(`\nℹ️  Old index "${oldIndexName}" not found (may have been already removed)`);
    }

    // Create the new partial unique index
    console.log('\n🔧 Creating new partial unique index for orderNumber...');
    await ordersCollection.createIndex(
      { orderNumber: 1 },
      {
        unique: true,
        partialFilterExpression: { orderNumber: { $type: 'string' } },
        name: 'uq_orderNumber_partial',
      }
    );
    console.log('✅ New partial unique index created successfully');

    // Verify the new index
    console.log('\n📋 Verifying new indexes...');
    const updatedIndexes = await ordersCollection.indexes();
    const newIndex = updatedIndexes.find(idx => idx.name === 'uq_orderNumber_partial');
    
    if (newIndex) {
      console.log('✅ New index verified:');
      console.log(JSON.stringify(newIndex, null, 2));
    } else {
      console.error('❌ New index not found after creation!');
    }

    // Check for any orders with duplicate orderNumbers (should be none after fix)
    console.log('\n🔍 Checking for duplicate orderNumbers...');
    const duplicates = await ordersCollection.aggregate([
      { $match: { orderNumber: { $ne: null, $type: 'string' } } },
      { $group: { _id: '$orderNumber', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();

    if (duplicates.length > 0) {
      console.warn('⚠️  Found duplicate orderNumbers:');
      console.log(duplicates);
    } else {
      console.log('✅ No duplicate orderNumbers found');
    }

    // Count orders with null orderNumbers (pending payment)
    const nullCount = await ordersCollection.countDocuments({ orderNumber: null });
    console.log(`\nℹ️  Orders with null orderNumber (pending payment): ${nullCount}`);

    console.log('\n🎉 Migration completed successfully!');
    console.log('\n📝 Summary:');
    console.log('   - Old unique index dropped');
    console.log('   - New partial unique index created');
    console.log('   - Multiple null values are now allowed');
    console.log('   - Assigned order numbers are still unique');

  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
}

// Run the migration
if (require.main === module) {
  fixOrderNumberIndex();
}

module.exports = { fixOrderNumberIndex };
