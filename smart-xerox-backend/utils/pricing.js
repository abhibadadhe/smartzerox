/**
 * Helper to parse a page range string (e.g., '1-5,7,10-12') and return exact page count.
 */
function getPageCountFromRange(rangeStr, totalPages) {
  if (!rangeStr || rangeStr.toLowerCase() === 'all') return totalPages;
  const indices = new Set();
  const parts = rangeStr.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end) && start > 0 && end >= start) {
        const actualEnd = Math.min(end, totalPages);
        for (let i = start; i <= actualEnd; i++) indices.add(i);
      }
    } else {
      const single = parseInt(trimmed, 10);
      if (!isNaN(single) && single > 0 && single <= totalPages) {
        indices.add(single);
      }
    }
  }
  return indices.size > 0 ? indices.size : totalPages;
}

/**
 * Calculate order pricing based on documents, shop pricing, and platform margin.
 * 
 * Commission split logic:
 *   - `shop.platformMargin` is the per-shop override (set by admin).
 *   - If shop.platformMargin > 0, it is used as-is.
 *   - If shop.platformMargin === 0, the `globalCommissionRate` param is used (default 0).
 *   - The commission is added ON TOP of the base price (customer pays base + commission).
 *   - Shop receives `shopReceivable` = base price (subtotal + additionalCharge).
 *   - Platform keeps `platformMargin` amount = commission.
 */
const calculateOrderPrice = (documents, shop, additionalServices = {}, globalCommissionRate = 0) => {
  let subtotal = 0;
  let totalPrintedSheets = 0;
  const documentPrices = [];

  documents.forEach((doc) => {
    let { printingRanges, detectedPages } = doc;
    let docPrice = 0;

    if (!printingRanges || printingRanges.length === 0) {
      // ✅ FIX EDGE CASE #2: Throw error instead of silent default
      // This ensures frontend MUST send explicit print settings
      throw new Error(
        `Document "${doc.originalName || 'unknown'}" missing printingRanges. ` +
        `All documents must have explicit colorMode and sides settings.`
      );
    }

    // Process each printing range
    printingRanges.forEach((range) => {
      const { rangeStart, rangeEnd, copies, colorMode, sides, pagesPerSheet = 1 } = range;
      const pagesInRange = rangeEnd - rangeStart + 1;
      
      // Calculate physical pages needed after grouping multiple document pages onto one physical side
      const physicalSidesNeeded = Math.ceil(pagesInRange / pagesPerSheet);

      // Effective sheets considering double-sided (only half sheets used)
      const effectiveSheets = sides === 'double' ? Math.ceil(physicalSidesNeeded / 2) : physicalSidesNeeded;
      totalPrintedSheets += effectiveSheets * copies;

      // Base price per sheet from shop with fallbacks
      const sidePriceKey = sides === 'double' ? 'doubleSided' : 'singleSided';
      const shopPricing = shop.pricing || {};
      const colorPricing = shopPricing[colorMode] || shopPricing['bw'] || {};
      const basePrice = colorPricing[sidePriceKey] || (colorMode === 'color' ? 5 : 1);

      docPrice += basePrice * effectiveSheets * copies;
    });

    documentPrices.push(docPrice);
    subtotal += docPrice;
  });

  // Additional services with updated pricing
  let additionalCharge = 0;
  const totalDocs = documents.length;

  if (additionalServices.spiralBinding) {
    additionalCharge += (shop.pricing.bindingPerDocument || 30) * totalDocs;
  }
  if (additionalServices.lamination) {
    additionalCharge += (shop.pricing.laminationPerPage || 10) * totalPrintedSheets;
  }
  if (additionalServices.urgentPrinting) {
    additionalCharge += Math.ceil(subtotal * 0.2); // 20% urgent surcharge
  }



  // Determine effective commission rate:
  // Per-shop override takes priority; fall back to global default.
  const effectiveCommissionRate = (shop.platformMargin > 0)
    ? shop.platformMargin
    : (globalCommissionRate || 0);

  // Platform commission amount (added on top — customer pays this)
  const platformMarginAmount = Math.ceil(((subtotal + additionalCharge) * effectiveCommissionRate) / 100);

  const total = subtotal + additionalCharge + platformMarginAmount;
  // Shop receives the base amount; platform keeps the commission
  const shopReceivable = subtotal + additionalCharge;

  return {
    subtotal,
    documentPrices,
    additionalCharge,
    platformMargin: platformMarginAmount,
    effectiveCommissionRate,
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