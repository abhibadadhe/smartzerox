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

  // 1. Commission rate %: Shop custom margin takes priority over Global rate
  const commissionPercent = (shop && shop.platformMargin !== undefined && shop.platformMargin !== null && Number(shop.platformMargin) > 0)
    ? Number(shop.platformMargin)
    : Number(globalCommissionRate || 0);

  // 2. Percentage commission amount (DEDUCTED FROM SHOPKEEPER)
  const percentCommission = commissionPercent > 0 
    ? Math.round((subtotal * commissionPercent) / 100 * 100) / 100 
    : 0;

  // 3. Flat page fee: ₹1 extra for admin if order > 5 pages (PAID BY CUSTOMER)
  const pageFee = totalOrderPages > 5 ? 1 : 0;

  // Total Platform Margin / Admin Revenue = Percent Commission (from shop) + Page Fee (from customer)
  const totalAdminFee = Math.round((percentCommission + pageFee) * 100) / 100;

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

  // Shop Gross amount
  const shopGross = subtotal + additionalCharge;

  // Shopkeeper receives: Shop Gross - Platform Commission (deducted from shopkeeper)
  const shopReceivable = Math.max(0, Math.round((shopGross - percentCommission) * 100) / 100);

  // Customer pays: Shop Gross + Flat Page Fee (only ₹1 if >5 pages; customer does NOT pay commission)
  const total = Math.round((shopGross + pageFee) * 100) / 100;

  return {
    subtotal,
    documentPrices,
    additionalCharge,
    platformMargin: totalAdminFee,
    commissionPercent,
    percentCommission,
    pageFee,
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
