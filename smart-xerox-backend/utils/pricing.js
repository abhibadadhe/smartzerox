/**
 * Calculate order pricing based on documents, shop pricing, and admin platform fee.
 * 
 * Commission & Fee Rules:
 *   - Base printing cost is calculated per document range (B&W or Color, Single or Double-sided).
 *   - ADMIN PLATFORM FEE: If overall pages count across the whole order is > 5 pages, add ₹1 extra for admin.
 *     (If overall order pages <= 5, admin fee = ₹0).
 *   - Shopkeeper receives: subtotal (printing cost) + additionalServices (spiral/lamination).
 *   - Admin receives: totalAdminFee (₹1 if total order pages > 5).
 *   - Student pays total = shopReceivable + totalAdminFee.
 */
const calculateOrderPrice = (documents, shop, additionalServices = {}, globalCommissionRate = 0) => {
  let subtotal = 0;
  let totalPrintedSheets = 0;
  let totalOrderPages = 0;
  const documentPrices = [];

  documents.forEach((doc) => {
    let { printingRanges, detectedPages } = doc;
    let docPrice = 0;

    if (!printingRanges || printingRanges.length === 0) {
      throw new Error(
        `Document "${doc.originalName || 'unknown'}" missing printingRanges. ` +
        `All documents must have explicit colorMode and sides settings.`
      );
    }

    // Process each printing range
    printingRanges.forEach((range) => {
      const { rangeStart, rangeEnd, copies = 1, colorMode, sides, pagesPerSheet = 1 } = range;
      const pagesInRange = Math.max(1, rangeEnd - rangeStart + 1);
      
      // Accumulate overall order pages
      totalOrderPages += pagesInRange * copies;

      const physicalSidesNeeded = Math.ceil(pagesInRange / pagesPerSheet);
      const effectiveSheets = sides === 'double' ? Math.ceil(physicalSidesNeeded / 2) : physicalSidesNeeded;
      totalPrintedSheets += effectiveSheets * copies;

      const sidePriceKey = sides === 'double' ? 'doubleSided' : 'singleSided';
      const shopPricing = shop.pricing || {};
      const colorPricing = shopPricing[colorMode] || shopPricing['bw'] || {};
      const basePrice = colorPricing[sidePriceKey] || (colorMode === 'color' ? 5 : 1);

      docPrice += basePrice * effectiveSheets * copies;
    });

    documentPrices.push(docPrice);
    subtotal += docPrice;
  });

  // Rule: If overall order page count > 5, add ₹1 extra fee for Admin
  const totalAdminFee = totalOrderPages > 5 ? 1 : 0;

  // Additional services (spiral, lamination, etc.)
  let additionalCharge = 0;
  const totalDocs = documents.length;

  if (additionalServices.spiralBinding) {
    additionalCharge += (shop.pricing?.bindingPerDocument || 30) * totalDocs;
  }
  if (additionalServices.lamination) {
    additionalCharge += (shop.pricing?.laminationPerPage || 10) * totalPrintedSheets;
  }
  if (additionalServices.urgentPrinting) {
    additionalCharge += Math.ceil(subtotal * 0.2);
  }

  // Shop receives 100% of printing and binding charges
  const shopReceivable = subtotal + additionalCharge;

  // Total student payment = Shop Receivable + Admin Fee
  const total = shopReceivable + totalAdminFee;

  return {
    subtotal,
    documentPrices,
    additionalCharge,
    platformMargin: totalAdminFee, // ₹1 if overall pages > 5, ₹0 if <= 5
    adminFee: totalAdminFee,
    totalOrderPages,
    total,
    shopReceivable,
  };
};

/**
 * Get pricing breakdown text for display
 */
const getPricingBreakdown = (order) => {
  const lines = [];
  order.documents.forEach((doc, i) => {
    lines.push(`Document ${i + 1} (${doc.originalName}): ₹${doc.price}`);
  });
  if (order.pricing.additionalServicesCharge > 0) {
    lines.push(`Additional Services: ₹${order.pricing.additionalServicesCharge}`);
  }
  if (order.pricing.platformMargin > 0) {
    lines.push(`Platform Fee: ₹${order.pricing.platformMargin}`);
  }
  lines.push(`Total: ₹${order.pricing.total}`);
  return lines.join('\n');
};

module.exports = { calculateOrderPrice, getPricingBreakdown };
