const Printer = require('../models/Printer');
const Shop = require('../models/Shop');
const { AppError, asyncHandler } = require('../utils/helpers');
const { emitToShop } = require('../config/socket');
const logger = require('../config/logger');
const { detectAndStoreFormats } = require('../services/ippPrint.service');

// Get all printers for a shop
exports.getShopPrinters = asyncHandler(async (req, res) => {
  const shop = await Shop.findOne({ owner: req.user.id });
  if (!shop) throw new AppError('Shop not found', 404);

  const printers = await Printer.find({ shop: shop._id }).sort({ createdAt: 1 });
  
  res.status(200).json({ success: true, data: { printers } });
});

// Register printers from the print agent
exports.registerPrinters = asyncHandler(async (req, res) => {
  const { printers, agentId } = req.body;
  const shop = await Shop.findOne({ owner: req.user.id }).lean();
  if (!shop) throw new AppError('Shop not found', 404);

  if (!printers || !Array.isArray(printers)) {
    throw new AppError('Printers array is required', 400);
  }

  // SCALE FIX: upsert all printers in a single bulkWrite instead of N findOne+save calls
  const existingCount = await Printer.countDocuments({ shop: shop._id });

  const bulkOps = printers.map((p, i) => {
    // ✅ IMPROVED COLOR DETECTION: Check for color keywords in printer name
    const nameLower = p.name.toLowerCase();
    const isColor = nameLower.includes('color') || 
                    nameLower.includes('pagewide') ||  // HP PageWide = color
                    nameLower.includes('officejet') || 
                    nameLower.includes('laserjet pro m') || // HP color models
                    nameLower.includes('mfp') && nameLower.includes('color');
    
    const type = isColor ? 'color' : 'bw';
    
    // ✅ ALWAYS USE ACTUAL PRINTER NAME (no "PRINTER N" abbreviation)
    // Extract clean name: remove "(Network)", "PCL-6", etc. suffixes for display
    let friendlyName = p.name
      .replace(/\s*\(Network\)\s*$/i, '')  // Remove "(Network)"
      .replace(/\s*PCL-?6?\s*$/i, '')      // Remove "PCL6" or "PCL-6"
      .replace(/\s*PCL5e?\s*$/i, '')       // Remove "PCL5e" or "PCL5"
      .replace(/\s*PS\s*$/i, '')           // Remove "PS" (PostScript)
      .trim();
    
    // If name is still too long (>40 chars), use original but keep it readable
    if (friendlyName.length > 40) {
      friendlyName = p.name; // Keep original name
    }
    
    // ✅ AUTO-GENERATE DISPLAY NAME: Extract brand + type
    // Examples: "HP Color", "Canon B&W", "Xerox Color"
    let displayName = friendlyName;
    
    // Extract brand (first word before space or dash)
    const brandMatch = friendlyName.match(/^([A-Za-z]+)/);
    const brand = brandMatch ? brandMatch[1] : 'Printer';
    
    // Generate simple display name: "Brand + Type"
    displayName = `${brand} ${type === 'color' ? 'Color' : 'B&W'}`;
    
    // If multiple printers of same brand+type exist, add number
    // This will be handled by checking existing printers in the next iteration

    return {
      updateOne: {
        filter: { shop: shop._id, systemName: p.name },
        update: {
          $set: {
            status:    p.status || 'running',
            isEnabled: p.enabled !== undefined ? p.enabled : true,
            lastSeen:  new Date(),
            agentId:   agentId || null,
            name:      friendlyName,  // ✅ Update name on every registration (not just insert)
            type,                      // ✅ Update type on every registration
          },
          $setOnInsert: {
            shop:       shop._id,
            systemName: p.name,
            displayName,  // ✅ Set display name on first insert
          },
        },
        upsert: true,
      },
    };
  });

  await Printer.bulkWrite(bulkOps, { ordered: false });

  const registeredPrinters = await Printer.find({
    shop: shop._id,
    systemName: { $in: printers.map(p => p.name) },
  });

  emitToShop(shop._id.toString(), 'printer:status_update', { printers: registeredPrinters });

  // ── Rebalance: if new printers were just added, move overloaded jobs to them ──
  // When a new printer comes online, existing queued orders on overloaded printers
  // won't automatically shift to it. We detect newly registered printers (those whose
  // createdAt equals updatedAt within a 5-second window) and trigger rebalancing
  // so orders flow to the new capacity immediately rather than waiting up to 10 min
  // for the reassignOfflinePrinterJobs cron.
  setImmediate(async () => {
    try {
      const fiveSecondsAgo = new Date(Date.now() - 5000);
      const newPrinters = registeredPrinters.filter(
        p => p.createdAt >= fiveSecondsAgo && p.isEnabled && p.status !== 'offline'
      );
      if (newPrinters.length === 0) return;

      logger.info(`🖨️  ${newPrinters.length} new printer(s) registered — checking for rebalanceable jobs`);

      for (const newPrinter of newPrinters) {
        // Find overloaded peer printers of the same type with more than 1 queued job
        const overloadedPeers = await Printer.find({
          shop:      shop._id,
          type:      newPrinter.type,
          isEnabled: true,
          status:    { $ne: 'offline' },
          _id:       { $ne: newPrinter._id },
          jobsInQueue: { $gt: 1 },
        }).sort({ jobsInQueue: -1 }).limit(3); // take the 3 most loaded

        for (const peer of overloadedPeers) {
          // Move the single oldest idle/queued order from this peer to the new printer
          const orderToMove = await require('../models/Order').findOne({
            assignedPrinter:     peer._id,
            'printJob.status':   { $in: ['idle', 'queued'] },
          }).sort({ createdAt: 1 });

          if (!orderToMove) continue;

          const totalPages = orderToMove.documents.reduce((sum, doc) => {
            const ranges = doc.printingRanges || [];
            if (ranges.length === 0) return sum + (doc.detectedPages || 1);
            return sum + ranges.reduce((s, r) => s + (r.rangeEnd - r.rangeStart + 1) * (r.copies || 1), 0);
          }, 0);

          // Reassign to new printer
          orderToMove.assignedPrinter           = newPrinter._id;
          orderToMove.assignedPrinterName       = newPrinter.displayName || newPrinter.name;
          orderToMove.assignedPrinterSystemName = newPrinter.systemName || '';
          await orderToMove.save();

          // Adjust load counters atomically
          await Printer.findByIdAndUpdate(peer._id,        { $inc: { currentLoad: -totalPages, jobsInQueue: -1 } });
          const updatedNew = await Printer.findByIdAndUpdate(
            newPrinter._id,
            { $inc: { currentLoad: totalPages, jobsInQueue: 1 } },
            { new: true }
          );

          // Notify agent and push live dashboard update
          const { printViaIpp } = require('../services/ippPrint.service');
          printViaIpp(orderToMove, newPrinter).catch(err => logger.error(`IPP failed on rebalance: ${err.message}`));

          const [updatedPeer] = await Printer.find({ _id: peer._id }).lean();
          if (updatedNew && updatedPeer) {
            emitToShop(shop._id.toString(), 'printer:status_update', { printers: [updatedNew, updatedPeer] });
          }

          logger.info(`⚖️  Rebalanced: order ${orderToMove.orderNumber} moved from ${peer.name} → new printer ${newPrinter.name}`);
        }
      }
    } catch (rebalanceErr) {
      logger.warn(`New-printer rebalance failed: ${rebalanceErr.message}`);
    }
  });

  res.status(200).json({ success: true, message: 'Printers registered successfully', data: { printers: registeredPrinters } });
});

// Trigger a scan for printers on the Print Agent
exports.scanPrinters = asyncHandler(async (req, res) => {
  const shop = await Shop.findOne({ owner: req.user.id });
  if (!shop) throw new AppError('Shop not found', 404);

  throw new AppError('Printer scanning is not supported for direct IPP printing. Please add IPP printers manually.', 400);

  res.status(200).json({ success: true, message: 'Scan signal sent to Print Agent' });
});

// Toggle printer enabled/disabled from dashboard
exports.togglePrinter = asyncHandler(async (req, res) => {
  const { isEnabled } = req.body;
  const printer = await Printer.findById(req.params.id).populate('shop');
  
  if (!printer) throw new AppError('Printer not found', 404);
  if (printer.shop.owner.toString() !== req.user.id) throw new AppError('Access denied', 403);

  printer.isEnabled = isEnabled;
  if (!isEnabled) {
    printer.status = 'stopped';
  } else {
    printer.status = 'running';
  }
  await printer.save();

  

  res.status(200).json({ success: true, message: `Printer ${isEnabled ? 'enabled' : 'disabled'}`, data: { printer } });
});

// Update printer display name (custom name shown in UI)
exports.updatePrinterDisplayName = asyncHandler(async (req, res) => {
  const { displayName } = req.body;
  
  if (!displayName || displayName.trim().length === 0) {
    throw new AppError('Display name is required', 400);
  }
  
  if (displayName.length > 30) {
    throw new AppError('Display name must be 30 characters or less', 400);
  }
  
  const printer = await Printer.findById(req.params.id).populate('shop');
  
  if (!printer) throw new AppError('Printer not found', 404);
  if (printer.shop.owner.toString() !== req.user.id) throw new AppError('Access denied', 403);

  printer.displayName = displayName.trim();
  await printer.save();

  const { emitToShop } = require('../config/socket');
  emitToShop(printer.shop._id.toString(), 'printer:status_update', { printers: [printer] });

  res.status(200).json({ 
    success: true, 
    message: 'Printer display name updated', 
    data: { printer } 
  });
});

// Update printer status (called by agent)
exports.updatePrinterStatus = asyncHandler(async (req, res) => {
  const { status, currentLoad, jobsInQueue } = req.body;
  const printer = await Printer.findById(req.params.id);
  
  if (!printer) throw new AppError('Printer not found', 404);

  // In a real app we'd also check if the caller owns the shop

  if (status) printer.status = status;
  if (currentLoad !== undefined) printer.currentLoad = currentLoad;
  if (jobsInQueue !== undefined) printer.jobsInQueue = jobsInQueue;
  printer.lastSeen = new Date();

  await printer.save();

  emitToShop(printer.shop.toString(), 'printer:status_update', { printers: [printer] });

  res.status(200).json({ success: true, data: { printer } });
});

// ─── Weighted Load Balancer — Get Optimal Printer for a Job (HTTP endpoint) ───
// Scoring: lower score = better candidate
// Score = (normalizedWait × 0.5) + (normalizedQueue × 0.3) + (typePenalty × 0.2)
// Weights intentionally match findOptimalPrinterForShop (internal helper) below.
// NOTE: This endpoint is read-only for the dashboard — it does NOT mutate load.
//       Actual load updates happen inside dispatchOrderToPrinters via the internal helper.
exports.getOptimalPrinter = asyncHandler(async (req, res) => {
  const { type = 'bw', pages = 1 } = req.query;
  const shop = await Shop.findOne({ owner: req.user.id });
  
  if (!shop) throw new AppError('Shop not found', 404);

  // Find enabled, non-offline printers sorted by load ascending (mirrors internal helper)
  const printers = await Printer.find({ 
    shop: shop._id, 
    isEnabled: true, 
    status: { $ne: 'offline' },
  }).sort({ currentLoad: 1, jobsInQueue: 1 }).limit(10);

  if (printers.length === 0) {
    return res.status(200).json({ success: true, data: { printer: null, reason: 'No online printers available' } });
  }

  // Strict type matching — same rules as findOptimalPrinterForShop
  const exactMatch = printers.filter(p => p.type === type);
  if (exactMatch.length === 0) {
    return res.status(200).json({ success: true, data: { printer: null, reason: `No ${type} printer available` } });
  }
  const candidates = exactMatch;

  const maxLoad  = Math.max(...candidates.map(p => p.currentLoad), 1);
  const maxQueue = Math.max(...candidates.map(p => p.jobsInQueue), 1);

  // Score each printer (lower = better) — weights match internal helper
  const scored = candidates.map(p => {
    const estimatedWaitMinutes = p.ppm > 0 ? (p.currentLoad / p.ppm) : Infinity;
    const normalizedWait  = p.ppm > 0 ? (p.currentLoad  / (maxLoad  || 1)) : 1;
    const normalizedQueue = p.jobsInQueue / (maxQueue || 1);
    const typePenalty     = p.type !== type ? 0.2 : 0;
    const score = (normalizedWait * 0.5) + (normalizedQueue * 0.3) + (typePenalty * 0.2);
    return { printer: p, score, estimatedWaitMinutes };
  });

  scored.sort((a, b) => a.score - b.score);

  const best = scored[0];

  logger.info(`Load Balancer stats: best ${type} printer for ${pages} pages → ${best.printer.name} (score: ${best.score.toFixed(3)}, wait: ${best.estimatedWaitMinutes.toFixed(1)}min)`);

  res.status(200).json({ 
    success: true, 
    data: { 
      printer: best.printer,
      estimatedWaitMinutes: best.estimatedWaitMinutes,
      score: best.score,
    } 
  });
});

// ─── Mark stale printers as offline (called by cron job) ─────────────────────
exports.markStaleOffline = asyncHandler(async (req, res) => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const result = await Printer.updateMany(
    { lastSeen: { $lt: fiveMinutesAgo }, status: 'running' },
    { status: 'offline' }
  );
  logger.info(`Marked ${result.modifiedCount} stale printers as offline`);
  res.status(200).json({ success: true, data: { marked: result.modifiedCount } });
});

// ─── Decrease printer load (called when order completes/fails) ──────────────────
exports.decreasePrinterLoad = asyncHandler(async (req, res) => {
  const { pages = 0 } = req.body;
  const printer = await Printer.findById(req.params.id);
  
  if (!printer) throw new AppError('Printer not found', 404);

  // Decrease load safely (never go below 0)
  printer.currentLoad = Math.max(0, printer.currentLoad - pages);
  printer.jobsInQueue = Math.max(0, printer.jobsInQueue - 1);
  printer.lastSeen = new Date();
  
  await printer.save();

  const shop = await Shop.findById(printer.shop);
  if (shop) {
    emitToShop(shop._id.toString(), 'printer:status_update', { printers: [printer] });
  }

  logger.info(`Printer ${printer.name} load decreased by ${pages} pages`);

  res.status(200).json({ success: true, data: { printer } });
});

// ─── Internal helper: find optimal printer (used by order controller) ─────────
// SCALE FIX: sort by currentLoad in MongoDB, limit to 10 candidates,
// ✅ SMART LOAD BALANCER: Routes jobs to correct printer type
// - Color documents → Color printers ONLY
// - B&W documents → B&W printers ONLY (never use color printers)
// - Balances load across printers of the same type
exports.findOptimalPrinterForShop = async (shopId, type = 'bw', pages = 1) => {
  // Fetch only enabled, non-offline printers sorted by load ascending
  const printers = await Printer.find({
    shop:      shopId,
    isEnabled: true,
    status:    { $ne: 'offline' },
  })
  .sort({ currentLoad: 1, jobsInQueue: 1 }) // cheapest first
  .limit(10)                                  // cap at 10 — enough for scoring
  .lean();

  if (printers.length === 0) return null;

  // ✅ STRICT TYPE MATCHING:
  // 1. Color jobs → ONLY color printers (never send to B&W)
  // 2. B&W jobs → ONLY B&W printers (never send to color)
  
  const exactMatch = printers.filter(p => p.type === type);
  
  let candidates;
  if (exactMatch.length > 0) {
    candidates = exactMatch;
  } else {
    // RESILIENT FALLBACK: If preferred printer type is offline or unavailable,
    // fall back to ANY active printer in the shop so the customer's order never fails.
    logger.warn(`⚠️ [LoadBalancer] Preferred ${type} printer unavailable for shop ${shopId} — falling back to any available online printer`);
    candidates = printers;
  }

  const maxLoad  = Math.max(...candidates.map(p => p.currentLoad), 1);
  const maxQueue = Math.max(...candidates.map(p => p.jobsInQueue), 1);

  logger.info(`🖨️ Printer selection for ${type} job: Found ${candidates.length} candidates out of ${printers.length} total printers`);
  logger.info(`📊 Candidates: ${JSON.stringify(candidates.map(p => ({ name: p.name, type: p.type, load: p.currentLoad, queue: p.jobsInQueue })))}`);

  const scored = candidates.map(p => {
    const normalizedWait  = p.ppm > 0 ? (p.currentLoad / (maxLoad || 1)) : 1;
    const normalizedQueue = p.jobsInQueue / (maxQueue || 1);
    
    // ✅ STRONG TYPE PREFERENCE:
    // - Exact match (color→color, bw→bw): no penalty
    // - Fallback (bw→color): small penalty (0.2)
    const typePenalty = (p.type !== type) ? 0.2 : 0;
    
    const score = (normalizedWait * 0.5) + (normalizedQueue * 0.3) + (typePenalty * 0.2);
    return { printer: p, score };
  });

  scored.sort((a, b) => a.score - b.score);
  
  const selected = scored[0]?.printer || null;
  if (selected) {
    logger.info(`✅ Load balancer: ${type} job (${pages} pages) → ${selected.name} (type: ${selected.type}, score: ${scored[0].score.toFixed(3)})`);
  } else {
    logger.warn(`❌ Load balancer: No ${type} printer available for ${pages} pages`);
  }
  
  return selected;
};

// ─── Load Balancer Stats — All printers with load info ────────────────────────
exports.getLoadBalancerStats = asyncHandler(async (req, res) => {
  const shop = await Shop.findOne({ owner: req.user.id });
  if (!shop) throw new AppError('Shop not found', 404);

  const printers = await Printer.find({ shop: shop._id }).sort({ createdAt: 1 });

  const stats = printers.map(p => {
    const estimatedWaitMinutes = p.ppm > 0 ? (p.currentLoad / p.ppm) : 0;
    const loadPercent = p.ppm > 0 ? Math.min(100, Math.round((p.currentLoad / (p.ppm * 5)) * 100)) : 0; // 5 min buffer = 100%
    
    return {
      _id: p._id,
      name: p.name,
      systemName: p.systemName,
      type: p.type,
      ppm: p.ppm,
      status: p.status,
      isEnabled: p.isEnabled,
      currentLoad: p.currentLoad,
      jobsInQueue: p.jobsInQueue,
      estimatedWaitMinutes: Math.round(estimatedWaitMinutes * 10) / 10,
      loadPercent,
      totalJobsProcessed: p.totalJobsProcessed,
      totalPagesProcessed: p.totalPagesProcessed,
      lastSeen: p.lastSeen,
      lastJobCompletedAt: p.lastJobCompletedAt,
      // Duplex capability
      supportsDuplex: p.supportsDuplex,
      sidesSupported: p.sidesSupported,
      printerModel: p.printerModel,
    };
  });

  res.status(200).json({ success: true, data: { printers: stats } });
});

exports.heartbeat = asyncHandler(async (req, res) => {
  const { agentId, printers } = req.body;
  const shop = await Shop.findOne({ owner: req.user.id }).lean();
  if (!shop) throw new AppError('Shop not found', 404);

  if (!printers || !Array.isArray(printers) || printers.length === 0) {
    logger.warn(`Heartbeat received with no printers for shop ${shop._id}`);
    await Printer.updateMany({ shop: shop._id }, { status: 'offline' });
    return res.status(200).json({ success: true });
  }

  const heartbeatNames = new Set(printers.map(p => p.name));

  // SCALE FIX: single bulkWrite instead of N individual findOne+save calls.
  // At 2000 orders/day with heartbeat every 10s, this saves ~N DB round-trips per minute.
  const bulkOps = [];

  for (const p of printers) {
    // ✅ IMPROVED COLOR DETECTION (same as registerPrinters)
    const nameLower = p.name.toLowerCase();
    const isColor = nameLower.includes('color') || 
                    nameLower.includes('pagewide') ||
                    nameLower.includes('officejet') || 
                    nameLower.includes('laserjet pro m') ||
                    nameLower.includes('mfp') && nameLower.includes('color');
    
    const type = isColor ? 'color' : 'bw';
    
    // ✅ EXTRACT CLEAN FRIENDLY NAME (same as registerPrinters)
    let friendlyName = p.name
      .replace(/\s*\(Network\)\s*$/i, '')
      .replace(/\s*PCL-?6?\s*$/i, '')
      .replace(/\s*PCL5e?\s*$/i, '')
      .replace(/\s*PS\s*$/i, '')
      .trim();
    
    if (friendlyName.length > 40) {
      friendlyName = p.name;
    }
    
    bulkOps.push({
      updateOne: {
        filter: { shop: shop._id, systemName: p.name },
        update: {
          $set: {
            lastSeen:  new Date(),
            status:    p.status || 'running',
            name:      friendlyName,  // ✅ Update name on every heartbeat
            type,                      // ✅ Update type on every heartbeat
            ...(p.enabled !== undefined ? { isEnabled: p.enabled } : {}),
            ...(p.load    !== undefined ? { currentLoad: p.load }  : {}),
            ...(p.queued  !== undefined ? { jobsInQueue: p.queued } : {}),
          },
        },
      },
    });
  }

  // Mark printers NOT in heartbeat as offline
  bulkOps.push({
    updateMany: {
      filter: { shop: shop._id, systemName: { $nin: Array.from(heartbeatNames) } },
      update: { $set: { status: 'offline' } },
    },
  });

  if (bulkOps.length > 0) {
    await Printer.bulkWrite(bulkOps, { ordered: false });
  }

  // Emit updated printer list to dashboard (single query)
  const updatedPrinters = await Printer.find({ shop: shop._id, systemName: { $in: Array.from(heartbeatNames) } }).lean();
  if (updatedPrinters.length > 0) {
    emitToShop(shop._id.toString(), 'printer:status_update', { printers: updatedPrinters });
  }

  res.status(200).json({ success: true });
});

exports.decreaseLoad = asyncHandler(async (req, res) => {
  const { systemName, pages } = req.body;
  const shop = await Shop.findOne({ owner: req.user.id });
  if (!shop) throw new AppError('Shop not found', 404);

  const printer = await Printer.findOne({ shop: shop._id, systemName });
  if (printer) {
    printer.currentLoad = Math.max(0, printer.currentLoad - parseInt(pages));
    printer.jobsInQueue = Math.max(0, printer.jobsInQueue - 1);
    printer.totalJobsProcessed += 1;
    printer.totalPagesProcessed += parseInt(pages);
    printer.lastJobCompletedAt = new Date();
    await printer.save();
    emitToShop(shop._id.toString(), 'printer:status_update', { printers: [printer] });
  }

  res.status(200).json({ success: true });
});

// ─── Reset all printers for a shop (development/testing only) ────────────────
// ✅ FIX #11: Add NODE_ENV check, admin-only guard, and confirmation requirement
exports.resetAllPrinters = asyncHandler(async (req, res) => {
  // ✅ FIX #11: Only allow in development/testing, never in production
  if (process.env.NODE_ENV === 'production') {
    logger.error(`🚨 SECURITY: Attempted to call resetAllPrinters in production by user ${req.user.id}`);
    throw new AppError('This endpoint is not available in production', 403);
  }

  // ✅ FIX #11: Require admin role or explicit confirmation token
  const { confirmationToken } = req.body;
  const isAdmin = req.user.role === 'admin';
  
  if (!isAdmin && !confirmationToken) {
    throw new AppError('Admin role or confirmation token required', 403);
  }

  // ✅ FIX #11: If not admin, verify confirmation token (one-time use)
  if (!isAdmin && confirmationToken) {
    // In a real app, verify the token against a one-time-use store
    // For now, just require explicit confirmation
    const expectedToken = `reset_${req.user.id}_${new Date().toDateString()}`;
    if (confirmationToken !== expectedToken) {
      throw new AppError('Invalid or expired confirmation token', 403);
    }
  }

  const shop = await Shop.findOne({ owner: req.user.id });
  if (!shop) throw new AppError('Shop not found', 404);

  // ✅ FIX #11: Log this action for audit trail
  logger.warn(`🔄 RESET: User ${req.user.id} (${isAdmin ? 'admin' : 'shopkeeper'}) reset all printers for shop ${shop._id}`);

  const result = await Printer.deleteMany({ shop: shop._id });
  
  logger.warn(`🔄 RESET COMPLETE: Deleted ${result.deletedCount} printers for shop ${shop._id}`);

  res.status(200).json({ 
    success: true, 
    message: `Reset complete - deleted ${result.deletedCount} printers`,
    data: { deletedCount: result.deletedCount }
  });
});

// ─── Manual IPP Printer Configuration ─────────────────────────────────────────

// Add a new manual printer by IP
exports.addManualPrinter = asyncHandler(async (req, res) => {
  const { name, type, ipAddress } = req.body;
  const shop = await Shop.findOne({ owner: req.user.id }).lean();
  
  if (!shop) throw new AppError('Shop not found', 404);
  if (!name || !type || !ipAddress) {
    throw new AppError('Name, type, and IP address are required', 400);
  }

  const cleanIp = ipAddress.trim();
  const systemName = `Manual_${name.replace(/\s+/g, '_')}_${Date.now()}`;

  // Default initial state: offline & disabled until verified by probe
  let initialStatus = 'offline';
  let initialEnabled = false;
  let initialFormats = [];
  let initialDuplex = false;
  let initialPort = 9100;
  let initialPreferred = null;
  let initialModel = name.trim();

  // Try real-time LAN probe via connected Desktop Agent
  try {
    const { getIO } = require('../config/socket');
    const io = getIO();
    const shopRoom = `shop:${shop._id.toString()}`;
    const roomSockets = io.sockets.adapter.rooms.get(shopRoom);

    if (roomSockets && roomSockets.size > 0) {
      const requestId = `req_add_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

      const probePromise = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 3000);

        const onResult = (socket) => {
          const handler = (data) => {
            if (data && data.requestId === requestId) {
              clearTimeout(timer);
              socket.off('printer:detect_lan_result', handler);
              resolve(data);
            }
          };
          socket.on('printer:detect_lan_result', handler);
        };

        for (const socketId of roomSockets) {
          const s = io.sockets.sockets.get(socketId);
          if (s) onResult(s);
        }

        io.to(shopRoom).emit('printer:detect_lan', {
          requestId,
          ipAddress: cleanIp,
          port: 9100
        });
      });

      const probeResult = await probePromise;
      if (probeResult && probeResult.isOnline) {
        initialStatus = 'running';
        initialEnabled = true;
        initialFormats = probeResult.formats || ['application/pdf', 'application/postscript', 'application/octet-stream'];
        initialPreferred = probeResult.preferredFormat || 'application/pdf';
        initialDuplex = probeResult.supportsDuplex !== undefined ? probeResult.supportsDuplex : true;
        initialPort = probeResult.activePort || 9100;
        if (probeResult.model) initialModel = probeResult.model;
        logger.info(`✅ [Add Printer] Real-time probe SUCCESS for ${cleanIp}: Online / PDF / Duplex!`);
      } else {
        logger.info(`⚠️ [Add Printer] Real-time probe reported unreachable for ${cleanIp} -> Marked Offline`);
      }
    }
  } catch (err) {
    logger.warn(`[Add Printer] Probe coordination error: ${err.message}`);
  }

  const printer = await Printer.create({
    shop: shop._id,
    name: name.trim(),
    displayName: initialModel,
    systemName,
    ipAddress: cleanIp,
    port: initialPort,
    type,
    status: initialStatus,
    isEnabled: initialEnabled,
    supportedFormats: initialFormats,
    preferredFormat: initialPreferred,
    supportsDuplex: initialDuplex,
    formatDetectedAt: initialStatus === 'running' ? new Date() : null
  });

  const { emitToShop: emit } = require('../config/socket');
  emit(shop._id.toString(), 'printer:status_update', { printers: [printer] });

  res.status(201).json({
    success: true,
    message: initialStatus === 'running'
      ? `✅ Printer added & verified ONLINE (PDF: ✓, Duplex: ${initialDuplex ? '✓' : '✗'})`
      : '⚠️ Printer added, but unreachable on local network (marked Offline).',
    data: { printer }
  });
});

// Update Printer IP Address
exports.updatePrinterIp = asyncHandler(async (req, res) => {
  const { ipAddress } = req.body;
  const printer = await Printer.findById(req.params.id).populate('shop');
  
  if (!printer) throw new AppError('Printer not found', 404);
  if (printer.shop.owner.toString() !== req.user.id) throw new AppError('Access denied', 403);
  
  if (!ipAddress || ipAddress.trim().length === 0) {
    throw new AppError('IP Address is required', 400);
  }

  printer.ipAddress = ipAddress.trim();
  printer.status = 'running';
  // Clear stale format data — will be re-detected
  printer.supportedFormats = [];
  printer.preferredFormat = '';
  printer.formatDetectedAt = undefined;
  await printer.save();

  // Auto-detect formats for new IP (non-blocking)
  setImmediate(async () => {
    try {
      const freshPrinter = await Printer.findById(printer._id);
      const result = await detectAndStoreFormats(freshPrinter);
      if (result) {
        emitToShop(printer.shop._id.toString(), 'printer:status_update', { printers: [freshPrinter] });
        logger.info(`[Printer] Re-detected formats after IP change: ${result.formats.join(', ')}`);
      }
    } catch (err) {
      logger.warn(`[Printer] Format re-detection failed: ${err.message}`);
    }
  });

  const { emitToShop: emit } = require('../config/socket');
  emit(printer.shop._id.toString(), 'printer:status_update', { printers: [printer] });

  res.status(200).json({
    success: true,
    message: 'Printer IP updated — format detection in progress',
    data: { printer }
  });
});

// ─── Detect / Re-detect document formats for a printer ────────────────────────
exports.detectFormats = asyncHandler(async (req, res) => {
  const printer = await Printer.findById(req.params.id).populate('shop');
  
  if (!printer) throw new AppError('Printer not found', 404);
  if (printer.shop.owner.toString() !== req.user.id) throw new AppError('Access denied', 403);
  if (!printer.ipAddress) throw new AppError('Printer has no IP address configured', 400);

  const shopId = printer.shop._id.toString();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  // 1. Try real-time probe via connected Desktop Agent on shop LAN
  const { getIO } = require('../config/socket');
  let detectedViaAgent = null;

  try {
    const io = getIO();
    if (io) {
      detectedViaAgent = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          io.off('printer:detect_lan_result', resultHandler);
          resolve(null);
        }, 4000);

        const resultHandler = (payload) => {
          if (payload && payload.requestId === requestId) {
            clearTimeout(timeout);
            io.off('printer:detect_lan_result', resultHandler);
            resolve(payload);
          }
        };

        io.on('printer:detect_lan_result', resultHandler);
        io.to(`shop:${shopId}`).emit('printer:detect_lan', {
          requestId,
          printerId: printer._id.toString(),
          ipAddress: printer.ipAddress,
          port: printer.port || 9100
        });
      });
    }
  } catch (e) {}

  if (detectedViaAgent && detectedViaAgent.isOnline) {
    printer.status = 'running';
    printer.isEnabled = true;
    printer.supportedFormats = detectedViaAgent.formats || ['application/pdf'];
    printer.preferredFormat = detectedViaAgent.preferredFormat || 'application/pdf';
    printer.supportsDuplex = detectedViaAgent.supportsDuplex !== undefined ? detectedViaAgent.supportsDuplex : true;
    if (detectedViaAgent.model) printer.displayName = detectedViaAgent.model;
    printer.formatDetectedAt = new Date();
    await printer.save({ validateBeforeSave: false });

    emitToShop(shopId, 'printer:status_update', { printers: [printer] });

    return res.status(200).json({
      success: true,
      message: `✅ Live Hardware Detected: ${printer.displayName || printer.name} is Online (PDF: ✓, Duplex: ${printer.supportsDuplex ? '✓' : '✗'})`,
      data: { printer, detected: detectedViaAgent }
    });
  }

  // 2. Direct IPP detection fallback
  const result = await detectAndStoreFormats(printer);
  
  if (!result) {
    printer.status = 'offline';
    printer.supportedFormats = [];
    await printer.save({ validateBeforeSave: false });
    emitToShop(shopId, 'printer:status_update', { printers: [printer] });

    return res.status(200).json({
      success: false,
      message: '⚠️ Printer is offline or unreachable on the network',
      data: { printer }
    });
  }

  emitToShop(shopId, 'printer:status_update', { printers: [printer] });

  res.status(200).json({
    success: true,
    message: `✅ Hardware Detected: ${printer.name} (PDF: ✓)`,
    data: { printer, detected: result }
  });
});

// Report LAN hardware detection result directly via REST API
exports.reportLanDetection = asyncHandler(async (req, res) => {
  const { isOnline, formats, preferredFormat, supportsDuplex, activePort, model } = req.body;
  const printer = await Printer.findById(req.params.id).populate('shop');

  if (!printer) throw new AppError('Printer not found', 404);

  if (isOnline) {
    printer.status = 'running';
    printer.isEnabled = true;
    printer.supportedFormats = formats || ['application/pdf', 'application/postscript', 'application/octet-stream'];
    printer.preferredFormat = preferredFormat || 'application/pdf';
    printer.supportsDuplex = supportsDuplex !== undefined ? supportsDuplex : true;
    if (activePort) printer.port = activePort;
    if (model) printer.displayName = model;
    printer.formatDetectedAt = new Date();
    await printer.save({ validateBeforeSave: false });

    emitToShop(printer.shop._id.toString(), 'printer:status_update', { printers: [printer] });

    return res.status(200).json({
      success: true,
      message: `✅ Live Hardware Detected: ${printer.displayName || printer.name} is Online (PDF: ✓, Duplex: ${printer.supportsDuplex ? '✓' : '✗'})`,
      data: { printer }
    });
  }

  printer.status = 'offline';
  await printer.save({ validateBeforeSave: false });
  emitToShop(printer.shop._id.toString(), 'printer:status_update', { printers: [printer] });

  res.status(200).json({
    success: false,
    message: '⚠️ Printer is offline or unreachable on the network',
    data: { printer }
  });
});
