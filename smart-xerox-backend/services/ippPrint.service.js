'use strict';

const ipp = require('ipp');
const { getObject } = require('../config/aws');
const logger = require('../config/logger');
const Order = require('../models/Order');
const Printer = require('../models/Printer');
const { emitToShop, emitToUser } = require('../config/socket');
const { stampOTPOnPDF } = require('../utils/pdfStamper');
const { convertForPrinter, isGhostscriptAvailable } = require('../utils/ghostscript');


// How long (ms) to wait for a single IPP Print-Job request before giving up.
// The `ipp` library has no built-in timeout, so an unreachable printer IP would
// otherwise hang the request until the OS-level TCP timeout (~1-2 min).
const IPP_REQUEST_TIMEOUT_MS = parseInt(process.env.IPP_REQUEST_TIMEOUT_MS || '20000', 10);

// Per-printer mutex queue map to serialize concurrent IPP requests to the same printer
const printerLocks = new Map();

async function withPrinterLock(printerId, taskFn) {
  const key = printerId.toString();
  const previousPromise = printerLocks.get(key) || Promise.resolve();

  let release;
  const currentPromise = new Promise((resolve) => { release = resolve; });
  printerLocks.set(key, previousPromise.then(() => currentPromise));

  try {
    await previousPromise;
    return await taskFn();
  } finally {
    release();
    if (printerLocks.get(key) === currentPromise) {
      printerLocks.delete(key);
    }
  }
}

/**
 * Maps the Order.js printing options to IPP attributes.
 *
 * IMPORTANT: IPP groups attributes into "tags". Job Template attributes
 * (copies, sides, media, print-color-mode, page-ranges, number-up) MUST be sent
 * under `job-attributes-tag`. Only document-format, job-name and
 * requesting-user-name belong under `operation-attributes-tag`.
 * Mixing them up makes the `ipp` serializer throw "Unknown attribute: copies"
 * and NO job is ever sent to the printer.
 *
 * @returns {{ operationAttributes: object, jobAttributes: object }}
 */
function mapOptionsToIppAttributes(doc, range, documentFormat) {
  const operationAttributes = {
    'document-format': documentFormat || 'application/pdf',
  };

  // ── Job Template Attributes ────────────────────────────────────────────────
  // IMPORTANT: Only include attributes that have a concrete value.
  // The `ipp` library logs "The spec is not clear on how to handle tag 16"
  // warnings for every attribute value that is `undefined`. These warnings are
  // harmless but noisy and indicate the attribute should be omitted entirely
  // rather than sent as undefined.

  // copies — always a positive integer; never undefined
  const copies = Math.max(1, parseInt(range.copies, 10) || 1);
  const jobAttributes = {
    'copies': copies,
  };

  // print-color-mode — map 'bw' → 'monochrome', anything else → 'color'
  // colorMode is required on the Order model so this should always be set,
  // but guard against missing data from the synthetic fallback range.
  if (range.colorMode) {
    jobAttributes['print-color-mode'] = range.colorMode === 'bw' ? 'monochrome' : 'color';
  }

  // sides — map 'double' → two-sided-long-edge, 'single' (or missing) → one-sided
  // sides is required on the Order model; guard the same way.
  if (range.sides) {
    jobAttributes['sides'] = range.sides === 'double' ? 'two-sided-long-edge' : 'one-sided';
  }

  // media (paper size) — only include when explicitly configured; omit to let
  // the printer use its default tray. Sending undefined crashes the serializer.
  if (doc.printingOptions && doc.printingOptions.paperSize) {
    const size = doc.printingOptions.paperSize.toLowerCase();
    const mediaMap = {
      a4:     'iso_a4_210x297mm',
      a3:     'iso_a3_297x420mm',
      letter: 'na_letter_8.5x11in',
    };
    const mapped = mediaMap[size];
    if (mapped) jobAttributes['media'] = mapped;
  }

  // page-ranges — the ipp library expects rangeOfInteger as [[lower, upper]].
  // Only include when both bounds are valid integers; omit entirely (print all
  // pages) when rangeStart/rangeEnd are absent or invalid so the serializer
  // never receives an undefined value.
  const start = parseInt(range.rangeStart, 10);
  const end   = parseInt(range.rangeEnd,   10);
  if (Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start) {
    jobAttributes['page-ranges'] = [[start, end]];
  }
  // else: omit page-ranges → printer prints the full document (correct default)

  // number-up (N-up / pages per sheet) — only include when > 1
  const pps = parseInt(range.pagesPerSheet, 10);
  if (Number.isInteger(pps) && pps > 1) {
    jobAttributes['number-up'] = pps;
  }

  return { operationAttributes, jobAttributes };
}

/**
 * Query a printer for IPP attributes (document formats, model info).
 * Returns { formats: string[], model: string } or null on failure.
 * This is called once (when a printer is added or its IP changes) and
 * the result is persisted in the Printer document — NOT on every print.
 */
/**
 * Query a printer for IPP attributes (document formats, model info).
 * Returns { formats: string[], model: string } or null on failure.
 * This is called once (when a printer is added or its IP changes) and
 * the result is persisted in the Printer document — NOT on every print.
 */
function queryPrinterAttributes(printerUrl, version = '2.0', timeoutMs = 10000) {
  let resolvedUrl = printerUrl;
  if (printerUrl.startsWith('https://') && !/:\d+\//.test(printerUrl) && !/:\d+$/.test(printerUrl)) {
    resolvedUrl = printerUrl.replace(/^(https:\/\/[^/]+)/, '$1:443');
  }
  const ippPrinter = ipp.Printer(resolvedUrl, { version: version || '2.0' });

  // Attach Cloudflare Access headers if this is a tunnel host
  if (printerUrl.startsWith('https://') && process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    ippPrinter.url.headers = {
      'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
    };
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    ippPrinter.execute('Get-Printer-Attributes', {
      'operation-attributes-tag': {
        'requested-attributes': [
          'document-format-supported',
          'printer-make-and-model',
          'sides-supported',           // ← detect duplex capability
          'print-color-mode-supported', // ← detect color capability
        ],
      }
    }, (err, res) => {
      clearTimeout(timer);
      if (err || !res) return resolve(null);
      try {
        const attrs = res['printer-attributes-tag'];

        const rawFormats = attrs?.['document-format-supported'];
        const formats = Array.isArray(rawFormats) ? rawFormats : (rawFormats ? [rawFormats] : []);

        const model = attrs?.['printer-make-and-model'] || '';

        // sides-supported: e.g. ['one-sided', 'two-sided-long-edge', 'two-sided-short-edge']
        const rawSides = attrs?.['sides-supported'];
        const sidesSupported = Array.isArray(rawSides) ? rawSides : (rawSides ? [rawSides] : []);
        const supportsDuplex = sidesSupported.some(s =>
          s === 'two-sided-long-edge' || s === 'two-sided-short-edge'
        );

        // print-color-mode-supported: e.g. ['monochrome', 'color']
        const rawColorModes = attrs?.['print-color-mode-supported'];
        const colorModesSupported = Array.isArray(rawColorModes)
          ? rawColorModes
          : (rawColorModes ? [rawColorModes] : []);

        resolve({ formats, model, sidesSupported, supportsDuplex, colorModesSupported });
      } catch (e) {
        resolve(null);
      }
    });
  });
}

/**
 * Auto-detect highest supported IPP version (2.0 first, fall back to 1.1).
 * Returns { version, result } where result is the queryPrinterAttributes response
 * so the caller can reuse it without a redundant network call.
 */
async function detectIppVersion(printerUrl) {
  logger.info(`[IPP-Detect] Probing IPP 2.0 support at ${printerUrl}...`);
  const res20 = await queryPrinterAttributes(printerUrl, '2.0', 5000);
  if (res20 && res20.formats && res20.formats.length > 0) {
    logger.info(`✅ [IPP-Detect] Printer supports IPP 2.0`);
    return { version: '2.0', result: res20 };
  }

  logger.info(`[IPP-Detect] IPP 2.0 probe failed/unsupported, probing IPP 1.1...`);
  const res11 = await queryPrinterAttributes(printerUrl, '1.1', 5000);
  if (res11 && res11.formats && res11.formats.length > 0) {
    logger.info(`✅ [IPP-Detect] Printer supports IPP 1.1`);
    return { version: '1.1', result: res11 };
  }

  logger.warn(`⚠️ [IPP-Detect] IPP version probe ambiguous, defaulting to 1.1 (universal baseline)`);
  return { version: '1.1', result: null };
}

function getPrinterUrl(rawAddress) {
  if (!rawAddress) return '';
  if (rawAddress.startsWith('http://') || rawAddress.startsWith('https://')) {
    return rawAddress.endsWith('/ipp/print') ? rawAddress : `${rawAddress.replace(/\/+$/, '')}/ipp/print`;
  }
  const cleanAddr = rawAddress.replace(/\/+$/, '');
  const hasPort = cleanAddr.includes(':');
  const isLocal = cleanAddr.startsWith('127.') || cleanAddr.startsWith('localhost');
  const scheme = isLocal ? 'http' : 'https';
  if (hasPort) {
    return `${scheme}://${cleanAddr}/ipp/print`;
  }
  const isRawIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(cleanAddr);
  if (isRawIp) {
    return `http://${cleanAddr}:631/ipp/print`;
  }
  return `https://${cleanAddr}/ipp/print`;
}

/**
 * Detect and persist supported document formats and IPP version for a printer.
 * Called automatically when a printer is added or its IP changes.
 * Updates the Printer document in-place and returns the detection result.
 *
 * @param {Object} printerDoc - Mongoose Printer document (must have ipAddress)
 * @returns {{ formats: string[], preferred: string, model: string, ippVersion: string } | null}
 */
async function detectAndStoreFormats(printerDoc) {
  if (!printerDoc.ipAddress) return null;

  const printerUrl = getPrinterUrl(printerDoc.ipAddress);

  logger.info(`[IPP-Detect] Querying format and IPP version support for ${printerDoc.name} at ${printerUrl}...`);
  
  // 1. Auto-detect best IPP version (also returns the query result to avoid redundant call)
  const { version: ippVersion, result } = await detectIppVersion(printerUrl);

  if (!result || result.formats.length === 0) {
    logger.warn(`[IPP-Detect] Could not detect formats for ${printerDoc.name} — printer may be offline`);
    return null;
  }

  // Pick the best format — priority:
  // 1. application/pdf (native, no conversion)
  // 2. application/postscript (Ghostscript can convert)
  // 3. application/vnd.hp-PCL (Ghostscript can convert)
  // 4. application/octet-stream (send PDF bytes as-is, Canon PDL must be enabled)
  let preferred = 'application/pdf'; // default
  const gs = isGhostscriptAvailable();

  if (result.formats.includes('application/pdf')) {
    preferred = 'application/pdf';
  } else if (result.formats.includes('application/postscript') && gs.available) {
    preferred = 'application/postscript';
    logger.info(`[IPP-Detect] Will use Ghostscript PDF→PS conversion (GS v${gs.version})`);
  } else if ((result.formats.includes('application/vnd.hp-PCL') || result.formats.includes('application/x-pcl')) && gs.available) {
    preferred = result.formats.includes('application/vnd.hp-PCL') ? 'application/vnd.hp-PCL' : 'application/x-pcl';
    logger.info(`[IPP-Detect] Will use Ghostscript PDF→PCL conversion (GS v${gs.version})`);
  } else if (result.formats.includes('application/octet-stream')) {
    preferred = 'application/octet-stream';
  } else if ((result.formats.includes('application/postscript') || result.formats.includes('application/vnd.hp-PCL')) && !gs.available) {
    // Printer supports PS/PCL but Ghostscript not installed
    logger.warn(`⚠️ [IPP-Detect] Printer supports PostScript/PCL but Ghostscript is NOT installed!`);
    logger.warn(`   Install: apt-get install ghostscript (Linux) or choco install ghostscript (Windows)`);
    preferred = result.formats[0] || 'application/pdf';
  } else {
    preferred = result.formats[0] || 'application/pdf';
  }

  // Warn if PDF not supported
  const supportsPDF = result.formats.includes('application/pdf');
  if (!supportsPDF) {
    if (preferred === 'application/postscript' || preferred.includes('PCL') || preferred.includes('pcl')) {
      logger.info(`✅ [IPP-Detect] ${printerDoc.name}: No PDF support, but Ghostscript will convert to ${preferred}`);
    } else {
      logger.warn(`⚠️ [IPP-Detect] ${printerDoc.name} does NOT support PDF directly!`);
      logger.warn(`   Supported: ${result.formats.join(', ')}`);
      logger.warn(`   → Using ${preferred}`);
    }
  } else {
    logger.info(`✅ [IPP-Detect] ${printerDoc.name} supports PDF natively`);
  }

  // Persist to DB
  printerDoc.ippVersion = ippVersion;
  printerDoc.supportedFormats = result.formats;
  printerDoc.preferredFormat = preferred;
  printerDoc.formatDetectedAt = new Date();
  printerDoc.printerModel = result.model || printerDoc.printerModel;
  // Persist duplex capability so printViaIpp can warn/log accurately
  if (result.sidesSupported !== undefined) {
    printerDoc.supportsDuplex   = result.supportsDuplex;
    printerDoc.sidesSupported   = result.sidesSupported;
  }
  await printerDoc.save();

  logger.info(`[IPP-Detect] ${printerDoc.name}: version=${ippVersion}, formats=${result.formats.join(', ')}, preferred=${preferred}, model=${result.model}`);
  logger.info(`[IPP-Detect] ${printerDoc.name}: duplex=${result.supportsDuplex}, sides=${result.sidesSupported.join(', ') || 'unknown'}`);
  return { ippVersion, formats: result.formats, preferred, model: result.model, supportsDuplex: result.supportsDuplex, sidesSupported: result.sidesSupported };
}

/**
 * Pick the best document format for a print job.
 * Uses the stored preferredFormat from the Printer document first.
 * Only falls back to runtime detection if no stored format exists.
 */
async function pickDocumentFormat(printer, printerUrl) {
  // 1. Use stored format if available and fresh (detected within last 24h)
  if (printer.preferredFormat) {
    const age = printer.formatDetectedAt ? (Date.now() - new Date(printer.formatDetectedAt).getTime()) : Infinity;
    const ONE_DAY = 24 * 60 * 60 * 1000;
    if (age < ONE_DAY) {
      logger.info(`[IPP] Using stored format for ${printer.name}: ${printer.preferredFormat}`);
      return printer.preferredFormat;
    }
    logger.info(`[IPP] Stored format for ${printer.name} is stale (${Math.round(age / 3600000)}h old), re-detecting...`);
  }

  // 2. Runtime detection fallback — also persists result for next time
  const printerDoc = await Printer.findById(printer._id);
  if (printerDoc) {
    const result = await detectAndStoreFormats(printerDoc);
    if (result) return result.preferred;
  }

  // 3. Last resort
  logger.warn(`[IPP] Format detection failed for ${printer.name}, defaulting to application/pdf`);
  return 'application/pdf';
}


/**
 * Send one Print-Job to the printer with a hard timeout.
 * Resolves with the IPP response, rejects on transport error, non-successful
 * IPP status code, or timeout.
 */
function sendPrintJob(printerUrl, msg, version = '2.0') {
  // The ipp library's request.js does:  if(!opts.port) opts.port = 631;
  // url.parse('https://host/path').port === null → falsy → gets overridden to 631.
  // Fix: inject the port explicitly into the URL string so url.parse() returns
  // a non-null port value that survives the library's check.
  //   https://printer1.pratibimb.online/ipp/print
  //   → https://printer1.pratibimb.online:443/ipp/print  (tunnel)
  //   http://192.168.1.80:631/ipp/print stays unchanged  (LAN — already has port)
  let resolvedUrl = printerUrl;
  if (printerUrl.startsWith('https://') && !/:\d+\//.test(printerUrl) && !/:\d+$/.test(printerUrl)) {
    // No explicit port in URL — insert :443 after the hostname
    resolvedUrl = printerUrl.replace(/^(https:\/\/[^/]+)/, '$1:443');
  }

  // Pass as string so the library parses it with url.parse(),
  // which will now return port='443' — a truthy value the library keeps.
  const ippPrinter = ipp.Printer(resolvedUrl, { version: version || '2.0' });

  // For Cloudflare tunnel hostnames (https), we must also attach Access service
  // token headers. The ipp library doesn't expose a way to set headers on the
  // Printer instance, so we monkey-patch the execute call to inject them via
  // Node's https.globalAgent or by directly calling the request with patched opts.
  // Simplest safe approach: patch request.js opts via a one-time override on the
  // underlying url object that the Printer stores.
  const isTunnelHost = printerUrl.startsWith('https://');
  if (isTunnelHost && process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    // ippPrinter.url is the parsed URL object passed to request(). We can add
    // headers directly to it — request.js merges them with its own Content-Type.
    ippPrinter.url.headers = {
      'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
    };
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`IPP request to ${printerUrl} timed out after ${IPP_REQUEST_TIMEOUT_MS}ms (printer unreachable?)`));
    }, IPP_REQUEST_TIMEOUT_MS);

    ippPrinter.execute('Print-Job', msg, (err, res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (err) return reject(err);

      // The printer can accept the TCP request (HTTP 200) but still reject the
      // job at the IPP layer, e.g. "client-error-*" / "server-error-*".
      // Treat anything that is not a "successful-*" status as a failure.
      const status = res && res.statusCode ? String(res.statusCode) : 'unknown';
      if (!status.startsWith('successful')) {
        return reject(new Error(`Printer rejected job (IPP status: ${status})`));
      }
      resolve(res);
    });
  });
}

/**
 * Execute an IPP Print-Job request with exponential backoff retry
 * @param {Object} order - Order document
 * @param {Object} printer - Printer document
 * @param {Number} retryCount - Current retry attempt (default: 0)
 * @param {Number} maxRetries - Maximum retry attempts (default: 3)
 */
async function printViaIpp(order, printer, retryCount = 0, maxRetries = 3) {
  if (!printer.ipAddress) {
    throw new Error(`Printer ${printer.name} does not have an IP address configured for IPP.`);
  }

  // If ipAddress is a hostname (e.g. Cloudflare tunnel domain like printer1.pratibimb.online),
  // don't append :631 since the tunnel already routes to the correct port internally.
  // If it's a raw IP address (e.g. 192.168.1.80), append :631 for direct IPP access.
  const printerUrl = getPrinterUrl(printer.ipAddress);
  const attemptLog = retryCount > 0 ? ` (retry ${retryCount}/${maxRetries})` : '';
  logger.info(`🖨️ [IPP] Starting print job for Order ${order.orderNumber || order._id} to ${printerUrl}${attemptLog}`);

  // Use stored format from DB (detected once on add/IP change) — no per-job overhead.
  // Falls back to runtime detection if not stored or stale.
  const documentFormat = await pickDocumentFormat(printer, printerUrl);
  logger.info(`[IPP] document-format for ${printer.name}: ${documentFormat}`);

  const latestOrder = await Order.findById(order._id);
  if (!latestOrder) {
    throw new Error(`Order ${order._id} not found when starting IPP print`);
  }
  latestOrder.printJob = latestOrder.printJob || {};
  latestOrder.printJob.status = 'printing';
  latestOrder.printJob.retryCount = retryCount;
  await latestOrder.save();

  // Notify UI
  if (latestOrder.shop) {
    emitToShop(latestOrder.shop.toString(), 'print:started', {
      orderId: latestOrder._id,
      orderNumber: latestOrder.orderNumber
    });
  }
  if (latestOrder.user) {
    emitToUser(latestOrder.user.toString(), 'order:status_update', {
      orderId: latestOrder._id,
      orderNumber: latestOrder.orderNumber,
      status: 'printing'
    });
  }

  // Resolve OTP placement once. After findById, `shop` is an unpopulated
  // ObjectId, so we populate just the otpPlacement field. (The previous
  // condition `shop.toString() === shop` was always false and silently
  // forced the default placement.)
  let otpPlacement = 'first_page';
  try {
    if (latestOrder.shop) {
      await latestOrder.populate('shop', 'otpPlacement');
      otpPlacement = latestOrder.shop?.otpPlacement || 'first_page';
    }
  } catch (e) {
    logger.warn(`[IPP] Could not load shop otpPlacement, using default: ${e.message}`);
  }

  try {
    // ✅ PRODUCTION FIX: Batch process documents for bulk orders
    // Process documents in batches to avoid memory issues with very large orders
    const BATCH_SIZE = parseInt(process.env.IPP_BATCH_SIZE) || 5;
    const docBatches = [];
    for (let i = 0; i < latestOrder.documents.length; i += BATCH_SIZE) {
      docBatches.push(latestOrder.documents.slice(i, i + BATCH_SIZE));
    }

    logger.info(`[IPP] Processing ${latestOrder.documents.length} documents in ${docBatches.length} batches (batch size: ${BATCH_SIZE})`);

    // Process each batch sequentially to control memory usage and avoid printer IPP socket collisions
    for (let batchIdx = 0; batchIdx < docBatches.length; batchIdx++) {
      const batch = docBatches[batchIdx];
      logger.info(`[IPP] Processing batch ${batchIdx + 1}/${docBatches.length} (${batch.length} documents)`);

      // Process documents within a batch sequentially to prevent concurrent TCP requests to same printer
      for (let i = 0; i < batch.length; i++) {
        const doc = batch[i];
        const docIndex = batchIdx * BATCH_SIZE + i;
        logger.info(`[IPP] Downloading ${doc.originalName} (${docIndex + 1}/${latestOrder.documents.length}) from S3...`);
        
        let pdfBuffer = await getObject(doc.s3Key);

        if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length < 10) {
          throw new Error(`Downloaded document ${doc.originalName} is empty or invalid`);
        }

        if (doc.isImageFile) {
          logger.info(`[IPP] Converting image ${doc.originalName} to PDF for IPP printing...`);
          try {
            const { rgb } = require('pdf-lib');
            const Jimp = require('jimp');

            // Use jimp to normalise the image to JPEG (pdf-lib works best with JPEG)
            const jimpImg = await Jimp.read(pdfBuffer);
            // A4 at 150 DPI = 1240 × 1754 px — resize to fit while keeping aspect ratio
            jimpImg.scaleToFit(1240, 1754);
            const jpegBuffer = await jimpImg.getBufferAsync(Jimp.MIME_JPEG);

            const pdfDoc = await PDFDocument.create();
            const jpgImage = await pdfDoc.embedJpg(jpegBuffer);
            // A4 in points: 595 × 842
            const page = pdfDoc.addPage([595, 842]);
            
            const printType = doc.imageOptions?.printType || 'full_page';

            if (printType === 'stamp_grid') {
              // Passport size: 3.5cm x 4.5cm
              const imgW = 35 * 2.8346; // 99.2 points
              const imgH = 45 * 2.8346; // 127.5 points
              const spacing = 5 * 2.8346; // 14.17 points (5mm)
              
              const cols = 4;
              const rows = 5;
              const totalW = (cols * imgW) + ((cols - 1) * spacing);
              const totalH = (rows * imgH) + ((rows - 1) * spacing);
              
              const startX = (595 - totalW) / 2;
              const startY = (842 - totalH) / 2;
              
              // Scale image to fit the 3.5x4.5 box
              const { width, height } = jpgImage.scale(1);
              const scale = Math.min(imgW / width, imgH / height);
              const finalW = width * scale;
              const finalH = height * scale;
              
              const drawCutLines = doc.imageOptions?.drawCutLines !== false;

              for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                  // pdf-lib's Y coordinate starts from bottom
                  const x = startX + c * (imgW + spacing);
                  const y = startY + (rows - 1 - r) * (imgH + spacing);
                  
                  // Center image inside its cell
                  const imgX = x + (imgW - finalW) / 2;
                  const imgY = y + (imgH - finalH) / 2;

                  page.drawImage(jpgImage, {
                    x: imgX,
                    y: imgY,
                    width: finalW,
                    height: finalH,
                  });
                  
                  if (drawCutLines) {
                    page.drawRectangle({
                      x: x,
                      y: y,
                      width: imgW,
                      height: imgH,
                      borderColor: rgb(0.8, 0.8, 0.8),
                      borderWidth: 0.5,
                    });
                  }
                }
              }
            } else if (printType === 'custom_size' && doc.imageOptions?.customWidthCm && doc.imageOptions?.customHeightCm) {
              const customW = doc.imageOptions.customWidthCm * 28.346;
              const customH = doc.imageOptions.customHeightCm * 28.346;
              
              const { width, height } = jpgImage.scale(1);
              const scale = Math.min(customW / width, customH / height);
              const finalW = width * scale;
              const finalH = height * scale;
              
              page.drawImage(jpgImage, {
                x: (595 - finalW) / 2,
                y: (842 - finalH) / 2,
                width: finalW,
                height: finalH,
              });
              
              if (doc.imageOptions?.drawCutLines !== false) {
                 page.drawRectangle({
                    x: (595 - customW) / 2,
                    y: (842 - customH) / 2,
                    width: customW,
                    height: customH,
                    borderColor: rgb(0.8, 0.8, 0.8),
                    borderWidth: 0.5,
                 });
              }
            } else {
              // full_page (default)
              const { width, height } = jpgImage.scale(1);
              const scale = Math.min(595 / width, 842 / height);
              page.drawImage(jpgImage, {
                x: (595 - width * scale) / 2,
                y: (842 - height * scale) / 2,
                width: width * scale,
                height: height * scale,
              });
            }

            pdfBuffer = Buffer.from(await pdfDoc.save());
            logger.info(`[IPP] Image converted to PDF (${printType}, ${pdfBuffer.length} bytes)`);
          } catch (convErr) {
            logger.warn(`[IPP] Image→PDF conversion failed: ${convErr.message} — sending raw`);
          }
        }

        // Determine OTP to stamp
        const otpToStamp = latestOrder.pickup?.pickupCode || latestOrder.kitOtp || latestOrder.orderNumber;
        if (otpToStamp) {
          logger.info(`[IPP] Stamping OTP ${otpToStamp} (${otpPlacement}) on ${doc.originalName}...`);
          pdfBuffer = await stampOTPOnPDF(pdfBuffer, otpToStamp, otpPlacement);
        }

        // Process each range sequentially.
        const ranges = doc.printingRanges && doc.printingRanges.length > 0
          ? doc.printingRanges
          : [{ copies: 1, colorMode: 'bw', sides: 'single' }];

        for (const range of ranges) {
          let sendBuffer = pdfBuffer;
          let sendFormat = documentFormat;

          const isDuplex = range.sides === 'double';
          const gs = isGhostscriptAvailable();

          const needsConversionForFormat = documentFormat !== 'application/pdf' && documentFormat !== 'application/octet-stream';
          const needsConversionForDuplex = isDuplex && (documentFormat === 'application/pdf' || documentFormat === 'application/octet-stream') && gs.available;

          if (needsConversionForFormat || needsConversionForDuplex) {
            const targetFormat = needsConversionForDuplex ? 'application/postscript' : documentFormat;
            try {
              logger.info(
                `[IPP] Converting PDF → ${targetFormat} via Ghostscript for ${printer.name} ` +
                `(range sides: ${range.sides}${needsConversionForDuplex ? ', forced for duplex' : ''})...`
              );
              const converted = await convertForPrinter(
                pdfBuffer, 
                targetFormat, 
                printer.supportedFormats || [],
                { sides: range.sides }
              );
              sendBuffer = converted.buffer;
              sendFormat = converted.mimeType;
              logger.info(`[IPP] Conversion done: ${pdfBuffer.length} → ${sendBuffer.length} bytes (${sendFormat})`);
            } catch (gsErr) {
              logger.warn(`[IPP] Ghostscript conversion failed: ${gsErr.message} — sending PDF as-is`);
              sendBuffer = pdfBuffer;
              sendFormat = 'application/pdf';
            }
          }

          const { operationAttributes, jobAttributes } = mapOptionsToIppAttributes(doc, range, sendFormat);
          operationAttributes['job-name'] = `Order-${latestOrder.orderNumber || latestOrder._id}-${doc.originalName}`;
          operationAttributes['requesting-user-name'] = 'SmartXerox-Backend';

          const duplexEmbeddedInStream = isDuplex && (sendFormat === 'application/postscript' || sendFormat.includes('pcl'));

          if (jobAttributes['sides'] === 'two-sided-long-edge') {
            logger.info(
              `✅ [IPP] Order ${latestOrder.orderNumber}: Duplex (2-sided) configured for "${printer.name}" ` +
              `(embedded in stream: ${duplexEmbeddedInStream}, IPP supportsDuplex=${printer.supportsDuplex})`
            );
          }

          // ── Log exact IPP attributes being sent ──
          logger.info(
            `[IPP] → Print-Job attrs for Order ${latestOrder.orderNumber}:` +
            ` sides=${jobAttributes['sides'] || 'not-set'}` +
            ` color=${jobAttributes['print-color-mode'] || 'not-set'}` +
            ` copies=${jobAttributes['copies']}` +
            ` page-ranges=${JSON.stringify(jobAttributes['page-ranges'] || 'all')}` +
            ` format=${operationAttributes['document-format']}`
          );

          logger.info(`[IPP] Sending job to ${printerUrl}`, { operationAttributes, jobAttributes });

          let finalBuffer = sendBuffer;

          const msg = {
            'operation-attributes-tag': operationAttributes,
            'job-attributes-tag': jobAttributes,
            data: finalBuffer
          };

          const ippVersion = printer.ippVersion || '1.1';

          // ✅ SERIALIZED IPP JOB DISPATCH VIA PER-PRINTER MUTEX LOCK
          await withPrinterLock(printer._id, async () => {
            let res;
            try {
              res = await sendPrintJob(printerUrl, msg, ippVersion);
            } catch (versionErr) {
              if (versionErr.message && versionErr.message.includes('version-not-supported')) {
                const fallbackVersion = ippVersion === '2.0' ? '1.1' : '2.0';
                logger.warn(
                  `⚠️ [IPP] IPP ${ippVersion} rejected by "${printer.name}", ` +
                  `retrying with IPP ${fallbackVersion}...`
                );
                res = await sendPrintJob(printerUrl, msg, fallbackVersion);
                try {
                  await Printer.findByIdAndUpdate(printer._id, { ippVersion: fallbackVersion });
                  logger.info(`[IPP] Updated stored IPP version for "${printer.name}" → ${fallbackVersion}`);
                } catch (dbErr) {
                  logger.warn(`[IPP] Could not persist IPP version update: ${dbErr.message}`);
                }
              } else {
                throw versionErr;
              }
            }
            logger.info(`[IPP] Print-Job accepted for ${latestOrder.orderNumber || latestOrder._id} (status: ${res?.statusCode})`);
            return res;
          });
        }

        // Clear buffer after processing to free memory
        pdfBuffer = null;
      }

      // Trigger GC between batches to prevent memory exhaustion in bulk orders
      if (global.gc && docBatches.length > 1) {
        try {
          const { forceGC } = require('../utils/memoryMonitor');
          forceGC();
          logger.debug(`[IPP] GC triggered after batch ${batchIdx + 1}`);
        } catch (e) { /* memoryMonitor not available, skip */ }
      }
    }

    // Mark completed
    latestOrder.printJob.status = 'completed';
    latestOrder.printJob.lastError = undefined;
    // If not already in a picked_up/ready state
    if (latestOrder.status === 'accepted' || latestOrder.status === 'printing') {
        latestOrder.status = 'ready';
    }
    await latestOrder.save();
    logger.info(`✅ [IPP] Order ${latestOrder.orderNumber || latestOrder._id} completed via IPP`);

    // Notify UI
    if (latestOrder.shop) {
      emitToShop(latestOrder.shop.toString(), 'print:completed', {
        orderId: latestOrder._id,
        orderNumber: latestOrder.orderNumber
      });
    }

  } catch (err) {
    logger.error(`❌ [IPP] Order ${latestOrder.orderNumber || latestOrder._id} failed: ${err.message}`);
    
    // ✅ PRODUCTION FIX: Implement retry logic for transient failures
    const isRetryableError = 
      err.message.includes('timeout') || 
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('ETIMEDOUT') ||
      err.message.includes('ENOTFOUND') ||
      err.message.includes('EHOSTUNREACH') ||
      err.message.includes('502') ||
      err.message.includes('503') ||
      err.message.includes('504');

    if (isRetryableError && retryCount < maxRetries) {
      const delayMs = Math.pow(2, retryCount) * 2000; // 2s, 4s, 8s
      logger.warn(`⏳ [IPP] Retrying order ${latestOrder.orderNumber} after ${delayMs}ms delay...`);
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
      
      // Recursive retry
      return printViaIpp(order, printer, retryCount + 1, maxRetries);
    }

    // ✅ AUTOMATIC REDISTRIBUTION: If assigned printer is overloaded/failed/offline,
    // automatically find another available printer of the same type in the shop and reassign.
    try {
      if (latestOrder.shop) {
        const { findOptimalPrinterForShop } = require('../controllers/printer.controller');
        const hasColor = latestOrder.documents?.some(doc =>
          doc.printingRanges?.some(r => r.colorMode === 'color')
        );
        const jobType = hasColor ? 'color' : 'bw';
        const totalPages = latestOrder.documents?.reduce((sum, doc) =>
          sum + (doc.printingRanges?.reduce((s, r) => s + ((r.rangeEnd - r.rangeStart + 1) * (r.copies || 1)), 0) || doc.detectedPages || 1), 0
        ) || 1;

        const alternatePrinter = await findOptimalPrinterForShop(latestOrder.shop, jobType, totalPages);
        if (alternatePrinter && alternatePrinter._id.toString() !== printer._id.toString()) {
          logger.info(
            `🔄 [IPP] Auto-redistributing Order ${latestOrder.orderNumber || latestOrder._id} ` +
            `from loaded/failed printer "${printer.name}" → "${alternatePrinter.name}"`
          );

          // Reassign order
          latestOrder.assignedPrinter = alternatePrinter._id;
          latestOrder.assignedPrinterName = alternatePrinter.displayName || alternatePrinter.name;
          latestOrder.assignedPrinterSystemName = alternatePrinter.systemName || '';
          latestOrder.printJob.status = 'printing';
          latestOrder.printJob.lastError = undefined;
          await latestOrder.save();

          // Update load counters on printers
          try {
            await Printer.findByIdAndUpdate(printer._id, { $inc: { currentLoad: -totalPages, jobsInQueue: -1 } });
            const updatedAlt = await Printer.findByIdAndUpdate(alternatePrinter._id, { $inc: { currentLoad: totalPages, jobsInQueue: 1 } }, { new: true });
            if (updatedAlt) {
              emitToShop(latestOrder.shop.toString(), 'printer:status_update', { printers: [updatedAlt] });
            }
          } catch (e) {}

          // Re-emit notification to UI
          emitToShop(latestOrder.shop.toString(), 'order:printer_reassigned', {
            orderId: latestOrder._id,
            orderNumber: latestOrder.orderNumber,
            oldPrinter: printer.name,
            newPrinter: alternatePrinter.name
          });

          // Dispatch to the alternate printer
          return printViaIpp(latestOrder, alternatePrinter, 0, maxRetries);
        }
      }
    } catch (redistributeErr) {
      logger.warn(`[IPP] Auto-redistribution attempt failed: ${redistributeErr.message}`);
    }

    // Mark as failed only after all retries and redistribution attempts are exhausted
    latestOrder.printJob.status = 'failed';
    latestOrder.printJob.lastError = err.message;
    latestOrder.printJob.retryCount = retryCount;
    latestOrder.printJob.failedAt = new Date();
    await latestOrder.save();

    // Notify UI with actionable message
    if (latestOrder.shop) {
      emitToShop(latestOrder.shop.toString(), 'print:error', {
        orderId: latestOrder._id,
        orderNumber: latestOrder.orderNumber,
        error: err.message,
        retryCount,
        isRetryable: isRetryableError && retryCount < maxRetries
      });
    }
    if (latestOrder.user) {
      const userMessage = isRetryableError 
        ? 'Printer temporarily unavailable. Please contact the shop for assistance.'
        : 'Printer error occurred. Please contact the shop for assistance.';
        
      emitToUser(latestOrder.user.toString(), 'print:issue', {
        orderId: latestOrder._id,
        issue: 'print_error',
        message: userMessage,
        timestamp: new Date().toISOString()
      });
    }
    
    // Re-throw to allow caller to handle
    throw err;
  }
}

module.exports = {
  printViaIpp,
  mapOptionsToIppAttributes,
  sendPrintJob,
  detectAndStoreFormats, // Called by printer controller on add/IP change
};
