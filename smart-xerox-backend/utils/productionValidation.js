/**
 * Production Validation Utilities
 * ─────────────────────────────────────────────────────────────────────────────
 * Comprehensive checks for order processing, printer routing, and color mode handling
 * to ensure production-grade reliability.
 */

'use strict';

const logger = require('../config/logger');

/**
 * Validates that an order's color mode configuration is consistent
 * and all ranges have valid color modes.
 * 
 * Returns: { isValid: boolean, errors: string[] }
 */
function validateOrderColorModes(order) {
  const errors = [];

  if (!order.documents || order.documents.length === 0) {
    errors.push('Order has no documents');
    return { isValid: false, errors };
  }

  for (let docIdx = 0; docIdx < order.documents.length; docIdx++) {
    const doc = order.documents[docIdx];
    const ranges = doc.printingRanges || [];

    if (ranges.length === 0) {
      errors.push(`Document ${docIdx + 1} has no printing ranges`);
      continue;
    }

    for (let rangeIdx = 0; rangeIdx < ranges.length; rangeIdx++) {
      const range = ranges[rangeIdx];

      // Validate color mode
      if (!['bw', 'color'].includes(range.colorMode)) {
        errors.push(
          `Document ${docIdx + 1}, Range ${rangeIdx + 1}: Invalid colorMode "${range.colorMode}". ` +
          `Must be "bw" or "color"`
        );
      }

      // Validate range boundaries
      if (range.rangeStart < 1 || range.rangeEnd < 1) {
        errors.push(
          `Document ${docIdx + 1}, Range ${rangeIdx + 1}: Invalid range. ` +
          `Start and end must be >= 1`
        );
      }

      if (range.rangeStart > range.rangeEnd) {
        errors.push(
          `Document ${docIdx + 1}, Range ${rangeIdx + 1}: Invalid range. ` +
          `Start (${range.rangeStart}) cannot be > end (${range.rangeEnd})`
        );
      }

      if (range.rangeEnd > (doc.detectedPages || 1000)) {
        errors.push(
          `Document ${docIdx + 1}, Range ${rangeIdx + 1}: Range end (${range.rangeEnd}) ` +
          `exceeds document pages (${doc.detectedPages})`
        );
      }

      // Validate copies
      if (!Number.isInteger(range.copies) || range.copies < 1 || range.copies > 100) {
        errors.push(
          `Document ${docIdx + 1}, Range ${rangeIdx + 1}: Invalid copies (${range.copies}). ` +
          `Must be integer between 1-100`
        );
      }

      // Validate sides
      if (!['single', 'double'].includes(range.sides)) {
        errors.push(
          `Document ${docIdx + 1}, Range ${rangeIdx + 1}: Invalid sides "${range.sides}". ` +
          `Must be "single" or "double"`
        );
      }

      // Validate pagesPerSheet
      const validPagesPerSheet = [1, 2, 4, 6, 9, 16];
      if (!validPagesPerSheet.includes(range.pagesPerSheet)) {
        errors.push(
          `Document ${docIdx + 1}, Range ${rangeIdx + 1}: Invalid pagesPerSheet (${range.pagesPerSheet}). ` +
          `Must be one of: ${validPagesPerSheet.join(', ')}`
        );
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Validates that printer assignments match the order's color mode requirements.
 * 
 * For mixed-color orders (divided into sub-orders):
 * - B&W sub-orders MUST be assigned to B&W printers
 * - Color sub-orders MUST be assigned to color printers
 * 
 * Returns: { isValid: boolean, errors: string[] }
 */
function validatePrinterAssignments(order, printers) {
  const errors = [];

  // If order is divided, validate each sub-order's printer
  if (order.isDivided && order.subOrders && order.subOrders.length > 0) {
    // Note: In production, you'd fetch sub-orders from DB here
    // For now, we validate the parent order's assignment logic
    
    if (!order.colorMode || order.colorMode !== 'mixed') {
      errors.push(
        `Order marked as divided but colorMode is "${order.colorMode}". ` +
        `Divided orders must have colorMode="mixed"`
      );
    }
  }

  // Validate single-mode order assignment
  if (!order.isDivided && order.assignedPrinter) {
    const printer = printers.find(p => p._id.toString() === order.assignedPrinter.toString());
    
    if (!printer) {
      errors.push(`Assigned printer not found in shop's printer list`);
    } else {
      // Determine expected printer type from order's color mode
      const expectedType = order.colorMode === 'color' ? 'color' : 'bw';
      
      if (printer.type !== expectedType) {
        errors.push(
          `Printer type mismatch: Order requires ${expectedType} printer, ` +
          `but assigned printer "${printer.name}" is type ${printer.type}`
        );
      }

      if (!printer.isEnabled) {
        errors.push(`Assigned printer "${printer.name}" is disabled`);
      }

      if (printer.status === 'offline') {
        errors.push(`Assigned printer "${printer.name}" is offline`);
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Validates that a shop has the required printer types for an order.
 * 
 * Returns: { isValid: boolean, errors: string[], missingTypes: string[] }
 */
function validateShopPrinterCapability(order, shopPrinters) {
  const errors = [];
  const missingTypes = [];

  // Determine required printer types
  let needsColor = false;
  let needsBW = false;

  for (const doc of order.documents) {
    const ranges = doc.printingRanges || [];
    
    if (ranges.length === 0) {
      needsBW = true;
    } else {
      for (const range of ranges) {
        if (range.colorMode === 'color') {
          needsColor = true;
        } else {
          needsBW = true;
        }
      }
    }
  }

  // Check availability
  const enabledPrinters = shopPrinters.filter(p => p.isEnabled && p.status !== 'offline');
  const hasColorPrinter = enabledPrinters.some(p => p.type === 'color');
  const hasBWPrinter = enabledPrinters.some(p => p.type === 'bw');

  if (needsColor && !hasColorPrinter) {
    errors.push('Order requires color printing but no color printer is available');
    missingTypes.push('color');
  }

  if (needsBW && !hasBWPrinter) {
    errors.push('Order requires B&W printing but no B&W printer is available');
    missingTypes.push('bw');
  }

  return { isValid: errors.length === 0, errors, missingTypes };
}

/**
 * Validates pricing calculation for an order with multiple ranges and color modes.
 * 
 * Returns: { isValid: boolean, errors: string[], warnings: string[] }
 */
function validateOrderPricing(order, shop) {
  const errors = [];
  const warnings = [];

  if (!order.pricing) {
    errors.push('Order has no pricing information');
    return { isValid: false, errors, warnings };
  }

  const { subtotal, total, shopReceivable, platformMargin, additionalServicesCharge } = order.pricing;

  // Validate totals
  if (subtotal < 0) {
    errors.push(`Invalid subtotal: ${subtotal} (must be >= 0)`);
  }

  if (total < 0) {
    errors.push(`Invalid total: ${total} (must be >= 0)`);
  }

  if (shopReceivable < 0) {
    errors.push(`Invalid shopReceivable: ${shopReceivable} (must be >= 0)`);
  }

  // Validate relationships: total = shopReceivable + platformMargin
  const expectedTotal = (shopReceivable || 0) + (platformMargin || 0);
  if (Math.abs(total - expectedTotal) > 0.01) {
    warnings.push(
      `Total (${total}) doesn't match shopReceivable (${shopReceivable}) + platformMargin (${platformMargin || 0}). ` +
      `Expected: ${expectedTotal}`
    );
  }

  const expectedReceivable = total - platformMargin;
  if (Math.abs(shopReceivable - expectedReceivable) > 0.01) {
    warnings.push(
      `Shop receivable (${shopReceivable}) doesn't match total (${total}) - margin (${platformMargin}). ` +
      `Expected: ${expectedReceivable}`
    );
  }

  // For divided orders, validate sub-order pricing sums
  if (order.isDivided && order.subOrders) {
    // Note: In production, fetch sub-orders and validate their pricing sums to parent
    warnings.push('Divided order pricing should be validated against sub-orders (requires DB fetch)');
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Comprehensive production validation for an order before acceptance.
 * 
 * Returns: { isValid: boolean, errors: string[], warnings: string[] }
 */
async function validateOrderForProduction(order, shop, shopPrinters) {
  const errors = [];
  const warnings = [];

  // 1. Validate color modes
  const colorModeValidation = validateOrderColorModes(order);
  if (!colorModeValidation.isValid) {
    errors.push(...colorModeValidation.errors);
  }

  // 2. Validate shop has required printers
  const printerCapabilityValidation = validateShopPrinterCapability(order, shopPrinters);
  if (!printerCapabilityValidation.isValid) {
    errors.push(...printerCapabilityValidation.errors);
  }

  // 3. Validate pricing
  const pricingValidation = validateOrderPricing(order, shop);
  if (!pricingValidation.isValid) {
    errors.push(...pricingValidation.errors);
  }
  warnings.push(...pricingValidation.warnings);

  // 4. Validate printer assignments (if already assigned)
  if (order.assignedPrinter) {
    const assignmentValidation = validatePrinterAssignments(order, shopPrinters);
    if (!assignmentValidation.isValid) {
      errors.push(...assignmentValidation.errors);
    }
  }

  // 5. Additional checks
  if (!order.pickup || !order.pickup.pickupCode) {
    warnings.push('Order has no pickup code assigned');
  }

  if (!order.payment || order.payment.status !== 'paid') {
    errors.push('Order payment not verified');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    summary: {
      colorModeValid: colorModeValidation.isValid,
      printerCapabilityValid: printerCapabilityValidation.isValid,
      pricingValid: pricingValidation.isValid,
      missingPrinterTypes: printerCapabilityValidation.missingTypes,
    },
  };
}

/**
 * Logs comprehensive validation results for debugging.
 */
function logValidationResults(orderNumber, validation) {
  if (validation.isValid) {
    logger.info(`✅ Order ${orderNumber} passed production validation`);
  } else {
    logger.error(`❌ Order ${orderNumber} failed production validation:`);
    validation.errors.forEach(err => logger.error(`   - ${err}`));
  }

  if (validation.warnings.length > 0) {
    logger.warn(`⚠️ Order ${orderNumber} has warnings:`);
    validation.warnings.forEach(warn => logger.warn(`   - ${warn}`));
  }
}

module.exports = {
  validateOrderColorModes,
  validatePrinterAssignments,
  validateShopPrinterCapability,
  validateOrderPricing,
  validateOrderForProduction,
  logValidationResults,
};
