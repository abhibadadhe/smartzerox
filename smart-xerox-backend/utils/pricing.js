/**
 * Calculate order pricing based on documents, shop pricing, and admin platform fee.
 * 
 * Commission & Fee Rules:
 *   - Base printing cost is calculated per document range (B&W or Color, Single or Double-sided).
 *   - ADMIN PLATFORM FEE: If a document has > 5 pages, add ₹1 extra per document.
 *     (If document has <= 5 pages, admin fee = ₹0).
 *   - Shopkeeper receives: subtotal (printing cost) + additionalServices (spiral/lamination).
 *   - Admin receives: totalAdminFee (₹1 per document with > 5 pages).
 *   - Student pays total = shopReceivable + totalAdminFee.
 */
const calculateOrderPrice = (documents, shop, additionalServices = {}, globalCommissionRate = 0) => {
  let subtotal = 0;
  let totalPrintedSheets = 0;
  let totalAdminFee = 0;
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

    // Calculate total pages for this document
    const docTotalPages = printingRanges.reduce((sum, r) => {
      const p = (r.rangeEnd - r.rangeStart + 1) * (r.copies || 1);
      return sum + p;
    }, 0) || (detectedPages || 1);

    // Rule: If document has > 5 pages, add ₹1 extra fee for admin
    if (docTotalPages > 5) {
      totalAdminFee += 1;
    }

    // Process each printing range
    printingRanges.forEach((range) => {
      const { rangeStart, rangeEnd, copies, colorMode, sides, pagesPerSheet = 1 } = range;
      const pagesInRange = rangeEnd - rangeStart + 1;
      
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
    platformMargin: totalAdminFee, // ₹1 per doc with > 5 pages
    adminFee: totalAdminFee,
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
