/**
 * Update Printer Names and Types Script
 * ─────────────────────────────────────────────────────────────────────
 * This script updates existing printer records to:
 * 1. Use actual printer names instead of "PRINTER N"
 * 2. Correctly detect color vs B&W printers
 * 
 * Run this once after deploying the new printer detection logic.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Printer = require('../models/Printer');

// Color detection logic (same as controller)
function detectPrinterType(systemName) {
  const nameLower = systemName.toLowerCase();
  const isColor = nameLower.includes('color') || 
                  nameLower.includes('pagewide') ||  // HP PageWide = color
                  nameLower.includes('officejet') || 
                  nameLower.includes('laserjet pro m') ||
                  nameLower.includes('mfp') && nameLower.includes('color');
  
  return isColor ? 'color' : 'bw';
}

// Extract clean friendly name
function extractFriendlyName(systemName) {
  let friendlyName = systemName
    .replace(/\s*\(Network\)\s*$/i, '')  // Remove "(Network)"
    .replace(/\s*PCL-?6?\s*$/i, '')      // Remove "PCL6" or "PCL-6"
    .replace(/\s*PCL5e?\s*$/i, '')       // Remove "PCL5e" or "PCL5"
    .replace(/\s*PS\s*$/i, '')           // Remove "PS" (PostScript)
    .trim();
  
  // If name is still too long (>40 chars), use original
  if (friendlyName.length > 40) {
    friendlyName = systemName;
  }
  
  return friendlyName;
}

// Generate display name (e.g., "HP Color", "Canon B&W")
function generateDisplayName(systemName, type) {
  const friendlyName = extractFriendlyName(systemName);
  
  // Extract brand (first word before space or dash)
  const brandMatch = friendlyName.match(/^([A-Za-z]+)/);
  const brand = brandMatch ? brandMatch[1] : 'Printer';
  
  // Generate simple display name: "Brand + Type"
  return `${brand} ${type === 'color' ? 'Color' : 'B&W'}`;
}

async function updatePrinterNames() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Find all printers
    const printers = await Printer.find({});
    console.log(`\n📋 Found ${printers.length} printer(s) to update\n`);

    let updatedCount = 0;

    for (const printer of printers) {
      const oldName = printer.name;
      const oldType = printer.type;
      const oldDisplayName = printer.displayName;

      // Calculate new values
      const newName = extractFriendlyName(printer.systemName);
      const newType = detectPrinterType(printer.systemName);
      const newDisplayName = generateDisplayName(printer.systemName, newType);

      // Check if update is needed
      const nameChanged = oldName !== newName;
      const typeChanged = oldType !== newType;
      const displayNameChanged = !oldDisplayName || oldDisplayName !== newDisplayName;

      if (nameChanged || typeChanged || displayNameChanged) {
        printer.name = newName;
        printer.type = newType;
        if (!oldDisplayName) {
          printer.displayName = newDisplayName;
        }
        await printer.save();
        updatedCount++;

        console.log(`✅ Updated: ${printer.systemName}`);
        if (nameChanged) {
          console.log(`   Name: "${oldName}" → "${newName}"`);
        }
        if (typeChanged) {
          console.log(`   Type: "${oldType}" → "${newType}"`);
        }
        if (displayNameChanged && !oldDisplayName) {
          console.log(`   Display Name: (none) → "${newDisplayName}"`);
        }
        console.log('');
      } else {
        console.log(`⏭️  Skipped: ${printer.systemName} (already correct)`);
      }
    }

    console.log(`\n✅ Update complete!`);
    console.log(`   Total printers: ${printers.length}`);
    console.log(`   Updated: ${updatedCount}`);
    console.log(`   Skipped: ${printers.length - updatedCount}`);

    // Show final state
    console.log(`\n📋 Final Printer List:\n`);
    const updatedPrinters = await Printer.find({}).sort({ createdAt: 1 });
    updatedPrinters.forEach((p, i) => {
      const typeIcon = p.type === 'color' ? '🌈' : '⬛';
      console.log(`${i + 1}. ${typeIcon} ${p.displayName || p.name} (${p.type.toUpperCase()})`);
      console.log(`   Full Name: ${p.name}`);
      console.log(`   System: ${p.systemName}`);
      console.log(`   Status: ${p.status} | Enabled: ${p.isEnabled}`);
      console.log('');
    });

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the update
updatePrinterNames();
