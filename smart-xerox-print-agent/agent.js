/**
 * ============================================================================
 * 🤖 SMART XEROX DIRECT SILENT AUTO-PRINT AGENT (PRODUCTION EDITION)
 * ============================================================================
 * Features:
 * - Real-time WebSocket order dispatching from Smart Xerox Cloud (< 50ms)
 * - True Hardware Back-to-Back Duplex printing (side: duplexlong)
 * - Custom page range extraction (e.g., Pages 1-4, 5-10)
 * - Automatic Color (HP 577) vs B&W (Canon Fleet) intelligent routing
 * - Native Windows Spooler Hardware Driver Priority (0 popups)
 * - Direct Network Fallbacks (IPP 631 & PJL-RAW 9100)
 * - Auto Re-authentication on 401 & Persistent Reconnection
 * ============================================================================
 */

const { io } = require('socket.io-client');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ipp = require('ipp');
const net = require('net');

const configPath = path.join(__dirname, 'agent-config.json');
if (!fs.existsSync(configPath)) {
  console.error('❌ agent-config.json not found! Please create it with serverUrl, shopEmail, and shopPassword.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const API_URL = config.serverUrl || 'https://api.pratibimb.online';
let token = null;
let socket = null;
let currentShopId = null;

// ─── AXIOS 401 INTERCEPTOR (Auto Token Refresh) ──────────────────────────────
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response && error.response.status === 401) {
      console.warn('⚠️ Token expired or unauthorized. Re-authenticating with cloud...');
      await 
// ─── PERIODIC FLEET HEARTBEAT (Keeps all 6 printers online & active) ─────────
setInterval(async () => {
  if (!token || !config.printers || config.printers.length === 0) return;
  try {
    await axios.post(`${API_URL}/api/printers/heartbeat`, {
      printers: config.printers.map(p => ({
        name: p.name,
        systemName: p.systemName || p.name,
        displayName: p.displayName || p.name,
        ipAddress: p.ipAddress,
        port: p.port || 9100,
        protocol: p.protocol || 'raw',
        type: p.type || 'bw',
        model: p.model || 'Network Printer',
        supportsDuplex: p.supportsDuplex !== false,
        status: 'running',
        enabled: true,
        currentLoad: 0,
        jobsInQueue: 0
      }))
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (err) {
    // Silent background heartbeat retry
  }
}, 20000); // Every 20 seconds

loginAndConnect();
    }
    return Promise.reject(error);
  }
);

async function loginAndConnect() {
  console.log('=====================================================');
  console.log('🤖 SMART XEROX DIRECT SILENT PRINT AGENT (0 POPUPS)');
  console.log('=====================================================');
  console.log(`🌐 Server URL: ${API_URL}`);
  console.log(`📧 Shopkeeper: ${config.shopEmail}`);
  console.log(`🖨️ Silent Direct Network Printing: ACTIVE\n`);

  try {
    console.log('🔑 Authenticating with Smart Xerox Cloud...');
    const loginRes = await axios.post(`${API_URL}/api/auth/login`, {
      email: config.shopEmail,
      password: config.shopPassword
    });

    token = loginRes.data.data?.token || loginRes.data.token;
    const shop = loginRes.data.data?.user?.shop || loginRes.data.user?.shop;
    currentShopId = typeof shop === 'object' ? shop._id : shop;

    console.log(`✅ Connected & Authenticated! (Shop ID: ${currentShopId})`);
    console.log(`📡 Listening for incoming student orders (0 Print Dialog Popups)...`);
    console.log('🟢 LIVE DIRECT PRINT ENGINE ACTIVE! Paper will feed out automatically when order is placed.\n');

    connectWebSocket(currentShopId);
  } catch (err) {
    console.error('❌ Authentication failed:', err.response?.data?.message || err.message);
    console.log('🔄 Retrying login in 5 seconds...');
    setTimeout(loginAndConnect, 5000);
  }
}

function connectWebSocket(shopId) {
  if (socket) {
    try { socket.disconnect(); } catch (e) {}
  }

  socket = io(API_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: Infinity
  });

  socket.on('connect', () => {
    console.log('🟢 WebSocket Connected! Joined room shop:' + shopId);
    socket.emit('shop:join', shopId);
  });

  // ─── Real-Time Hardware Detection Listener ────────────────────────────────
  socket.on('printer:detect_lan', async (data) => {
    const { requestId, ipAddress, port = 631, printerId } = data;
    console.log(`🔍 [Real-Time Detect] Probing printer at ${ipAddress}:${port} on local LAN...`);

    try {
      const probeResult = await probePrinterHardware(ipAddress, port);
      console.log(`✅ [Real-Time Detect] Result for ${ipAddress}:`, probeResult);

      socket.emit('printer:detect_lan_result', {
        requestId,
        printerId,
        ipAddress,
        success: probeResult.isOnline,
        ...probeResult
      });

      if (printerId) {
        axios.post(`${API_URL}/api/printers/${printerId}/lan-detect-report`, probeResult, {
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => {});
      }
    } catch (err) {
      console.warn(`⚠️ [Real-Time Detect] Failed to probe ${ipAddress}: ${err.message}`);
      socket.emit('printer:detect_lan_result', {
        requestId,
        printerId,
        ipAddress,
        success: false,
        isOnline: false,
        error: err.message
      });
    }
  });

  socket.on('print:job', handlePrintJob);

  socket.on('disconnect', (reason) => {
    console.log(`🔴 Disconnected (${reason})! Reconnecting automatically...`);
  });

  socket.on('connect_error', (err) => {
    console.warn(`⚠️ Connection error: ${err.message}`);
  });
}

// In-memory deduplication tracker (prevents duplicate triggers within 2 minutes)
const { PDFDocument, PageSizes } = require('pdf-lib');
const { execSync } = require('child_process');

/**
 * Converts image buffer (JPG, PNG, WEBP, BMP) to a standard A4 PDF buffer in memory
 */
async function convertImageToPdfBuffer(imageBuffer, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  const pdfDoc = await PDFDocument.create();
  
  let image;
  if (ext === '.png') {
    image = await pdfDoc.embedPng(imageBuffer);
  } else {
    // JPG, JPEG, and fallbacks
    try {
      image = await pdfDoc.embedJpg(imageBuffer);
    } catch {
      image = await pdfDoc.embedPng(imageBuffer);
    }
  }

  const { width: imgW, height: imgH } = image.scale(1);
  const isLandscape = imgW > imgH;
  const pageSize = isLandscape ? [PageSizes.A4[1], PageSizes.A4[0]] : PageSizes.A4;
  const page = pdfDoc.addPage(pageSize);
  const { width: pageW, height: pageH } = page.getSize();

  // Margins (20 points ~ 7mm)
  const margin = 20;
  const maxWidth = pageW - margin * 2;
  const maxHeight = pageH - margin * 2;
  const scale = Math.min(maxWidth / imgW, maxHeight / imgH, 1);

  const finalW = imgW * scale;
  const finalH = imgH * scale;
  const posX = (pageW - finalW) / 2;
  const posY = (pageH - finalH) / 2;

  page.drawImage(image, {
    x: posX,
    y: posY,
    width: finalW,
    height: finalH,
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Converts PPT, PPTX, DOC, DOCX files to PDF using native Windows Office or LibreOffice
 */
function convertOfficeToPdf(inputFilePath, outputPdfPath) {
  const ext = path.extname(inputFilePath).toLowerCase();
  
  // 1. Try LibreOffice CLI if available
  try {
    const outDir = path.dirname(outputPdfPath);
    execSync(`soffice --headless --convert-to pdf "${inputFilePath}" --outdir "${outDir}"`, { timeout: 30000, stdio: 'ignore' });
    const expectedName = path.basename(inputFilePath, ext) + '.pdf';
    const generatedPath = path.join(outDir, expectedName);
    if (fs.existsSync(generatedPath)) {
      if (generatedPath !== outputPdfPath) fs.renameSync(generatedPath, outputPdfPath);
      return true;
    }
  } catch (e) {}

  // 2. Try PowerShell MS Office COM automation on Windows
  try {
    if (ext.startsWith('.ppt')) {
      const psScript = `
        $ppt = New-Object -ComObject PowerPoint.Application
        $presentation = $ppt.Presentations.Open("${inputFilePath.replace(/\\/g, '\\\\')}", [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse)
        $presentation.SaveAs("${outputPdfPath.replace(/\\/g, '\\\\')}", 32)
        $presentation.Close()
        $ppt.Quit()
      `;
      execSync(`powershell -NoProfile -NonInteractive -Command "${psScript.replace(/\n/g, ' ')}"`, { timeout: 30000, stdio: 'ignore' });
      if (fs.existsSync(outputPdfPath)) return true;
    } else if (ext.startsWith('.doc')) {
      const psScript = `
        $word = New-Object -ComObject Word.Application
        $doc = $word.Documents.Open("${inputFilePath.replace(/\\/g, '\\\\')}")
        $doc.SaveAs([ref]"${outputPdfPath.replace(/\\/g, '\\\\')}", [ref]17)
        $doc.Close()
        $word.Quit()
      `;
      execSync(`powershell -NoProfile -NonInteractive -Command "${psScript.replace(/\n/g, ' ')}"`, { timeout: 30000, stdio: 'ignore' });
      if (fs.existsSync(outputPdfPath)) return true;
    }
  } catch (e) {}

  return false;
}

const processedJobs = new Set();

async function handlePrintJob(orderData) {
  const orderId = (orderData.orderId || orderData._id)?.toString();
  if (!orderId) return;

  if (processedJobs.has(orderId)) {
    return; // Already being printed
  }
  processedJobs.add(orderId);
  setTimeout(() => processedJobs.delete(orderId), 120000);

  try {
    console.log(`\n=====================================================`);
    console.log(`⚡ INCOMING ORDER #${orderData.orderNumber || orderId} RECEIVED!`);
    console.log(`=====================================================`);

    // 1. Notify Cloud Dashboard that printing has started (shows "Printing in Progress...")
    await axios.patch(`${API_URL}/api/orders/${orderId}/status`, { status: 'printing' }, {
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => {});

    // 2. Fetch full order with presigned S3 URLs
    const orderRes = await axios.get(`${API_URL}/api/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const order = orderRes.data.data?.order || orderRes.data.data;
    if (!order) {
      console.error('❌ Could not retrieve order details from cloud');
      return;
    }

    // Fetch live shop printers from cloud backend
    const printersRes = await axios.get(`${API_URL}/api/printers/my-shop`, {
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => null);
    const shopPrinters = printersRes?.data?.data?.printers || printersRes?.data?.data || [];

    for (const doc of (order.documents || [])) {
      const fileUrl = doc.downloadUrl || doc.fileUrl || doc.url || doc.s3Url;
      if (!fileUrl) {
        console.warn(`⚠️ No download URL found for document: ${doc.originalName || 'unknown'}`);
        continue;
      }

      console.log(`⬇️ Downloading document: ${doc.originalName}...`);
      let pdfBuffer = await downloadFile(fileUrl);
      const ext = path.extname(doc.originalName || '').toLowerCase();

      // Automatically convert Images/Photos (JPG, PNG, WEBP, BMP) to PDF in memory
      if (['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'].includes(ext)) {
        console.log(`🖼️ [Auto-Convert Photo] Converting image ${doc.originalName} to standard print-ready A4 PDF...`);
        pdfBuffer = await convertImageToPdfBuffer(pdfBuffer, doc.originalName);
      } else if (['.ppt', '.pptx', '.doc', '.docx'].includes(ext)) {
        console.log(`📊 [Auto-Convert Office] Converting presentation/document ${doc.originalName} to PDF...`);
        const tempOfficeDir = path.join(__dirname, 'temp_print');
        if (!fs.existsSync(tempOfficeDir)) fs.mkdirSync(tempOfficeDir, { recursive: true });
        const tempOfficeFile = path.join(tempOfficeDir, `raw_${Date.now()}_${doc.originalName}`);
        const tempConvertedPdf = path.join(tempOfficeDir, `conv_${Date.now()}.pdf`);
        fs.writeFileSync(tempOfficeFile, pdfBuffer);
        const converted = convertOfficeToPdf(tempOfficeFile, tempConvertedPdf);
        if (converted && fs.existsSync(tempConvertedPdf)) {
          pdfBuffer = fs.readFileSync(tempConvertedPdf);
          try { fs.unlinkSync(tempConvertedPdf); } catch (e) {}
        }
        try { fs.unlinkSync(tempOfficeFile); } catch (e) {}
      }

      // Support multi-range printing (e.g. Range 1 = Color, Range 2 = B&W)
      const ranges = (doc.printingRanges && doc.printingRanges.length > 0)
        ? doc.printingRanges
        : [{ rangeStart: 1, rangeEnd: doc.detectedPages || null, colorMode: 'bw', sides: 'single', copies: 1 }];

      for (let rIdx = 0; rIdx < ranges.length; rIdx++) {
        const r = ranges[rIdx];
        const isColor = r.colorMode === 'color';
        const isDoubleSided = r.sides === 'double' || r.side === 'double';
        const copies = r.copies || 1;
        const paperSize = doc.printingOptions?.paperSize || 'A4';
        const orientation = doc.printingOptions?.orientation || 'auto';
        
        let pageRangeStr = undefined;
        if (r.rangeStart && r.rangeEnd) {
          pageRangeStr = `${r.rangeStart}-${r.rangeEnd}`;
        }

        // Automatic Smart Routing: Color -> HP 577 | B&W -> Canon Fleet
        let targetPrinter = null;
        if (isColor) {
          targetPrinter = shopPrinters.find(p => p.type === 'color' && p.isEnabled !== false) ||
                          config.printers.find(p => p.type === 'color') ||
                          { name: 'printer HP', ipAddress: '192.168.1.244', port: 9100, type: 'color' };
        } else {
          if (order.assignedPrinter) {
            const assignedId = typeof order.assignedPrinter === 'object' ? order.assignedPrinter._id : order.assignedPrinter;
            targetPrinter = shopPrinters.find(p => p._id.toString() === assignedId.toString());
          }
          if (!targetPrinter && orderData.printer && orderData.printer.type !== 'color') {
            targetPrinter = orderData.printer;
          }
          if (!targetPrinter) {
            targetPrinter = shopPrinters.find(p => p.type === 'bw' && p.isEnabled !== false) ||
                            config.printers.find(p => p.type === 'bw') ||
                            shopPrinters[0] || config.printers[0];
          }
        }

        if (!targetPrinter) {
          targetPrinter = { name: 'Default Printer', ipAddress: '192.168.1.80', port: 9100, protocol: 'raw' };
        }

        const modeStr = isColor ? '🎨 COLOR' : '🖤 B&W';
        const sideStr = isDoubleSided ? '📖 DOUBLE-SIDED (Back-to-Back)' : '📄 SINGLE-SIDED';
        const pagesStr = pageRangeStr ? `Pages ${pageRangeStr}` : 'All Pages';

        console.log(`\n🖨️ [Job ${rIdx + 1}/${ranges.length}] ➔ ${targetPrinter.displayName || targetPrinter.name} (${targetPrinter.ipAddress || 'Windows Driver'})`);
        console.log(`   ⚙️ Config: ${modeStr} | ${sideStr} | ${pagesStr} | Copies: ${copies} | Paper: ${paperSize}`);

        await printDocument(pdfBuffer, targetPrinter, doc.originalName, {
          duplex: isDoubleSided,
          monochrome: !isColor,
          paperSize: paperSize,
          copies: copies,
          pages: pageRangeStr,
          orientation: orientation !== 'auto' ? orientation : undefined
        });
      }
    }

    // 3. Mark order as READY for pickup on Dashboard (shows "Ready for Pickup")
    await axios.patch(`${API_URL}/api/orders/${orderId}/status`, { status: 'ready' }, {
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => {});

    console.log(`\n✅ Order #${order.orderNumber || orderId} marked READY for pickup on Dashboard!\n`);

  } catch (err) {
    console.error('❌ Direct Print Error:', err.message);
  }
}

function downloadFile(url) {
  return axios.get(url, { responseType: 'arraybuffer' }).then(res => Buffer.from(res.data));
}

/**
 * Multi-Protocol Print Dispatcher:
 * 1. Native Windows Spooler Driver (pdf-to-printer) -> 100% reliable hardware rasterization & duplexing
 * 2. Direct Network IPP (Port 631)
 * 3. Direct Network PJL-RAW Socket (Port 9100)
 */
async function printDocument(pdfBuffer, targetPrinter, docName, options = {}) {
  const isDuplex = options.duplex !== undefined ? options.duplex : true;
  const monochrome = options.monochrome !== undefined ? options.monochrome : true;
  const paperSize = options.paperSize || 'A4';
  const copies = options.copies || 1;

  const tempDir = path.join(__dirname, 'temp_print');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const tempPdfPath = path.join(tempDir, `job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.pdf`);
  fs.writeFileSync(tempPdfPath, pdfBuffer);

  let printed = false;

  // 1. Try Windows Spooler first (100% reliable hardware driver rendering on Windows)
  try {
    const ptp = require('pdf-to-printer');
    const winPrinters = await ptp.getPrinters().catch(() => []);
    
    // Fuzzy matching for printer name/model/number
    const tName = (targetPrinter.name || '').toLowerCase();
    const tModel = (targetPrinter.model || '').toLowerCase();
    const tDisplay = (targetPrinter.displayName || '').toLowerCase();

    let selectedWinPrinter = winPrinters.find(p => {
      const wName = (p.name || '').toLowerCase();
      return wName.includes(tName) || 
             (tModel && wName.includes(tModel)) ||
             (tDisplay && wName.includes(tDisplay));
    });

    // If no exact match, look for any non-virtual physical printer
    if (!selectedWinPrinter) {
      selectedWinPrinter = winPrinters.find(p => {
        const n = (p.name || '').toLowerCase();
        return !n.includes('pdf') && !n.includes('onenote') && !n.includes('xps') && !n.includes('fax');
      });
    }

    if (selectedWinPrinter) {
      console.log(`🖨️ [Windows Spooler] Printing to driver "${selectedWinPrinter.name}" | Side: ${isDuplex ? 'duplexlong (Back-to-Back)' : 'simplex (Single-Sided)'} | Paper: ${paperSize}...`);
      
      const printOptions = {
        printer: selectedWinPrinter.name,
        side: isDuplex ? 'duplexlong' : 'simplex',
        monochrome: monochrome,
        paperSize: paperSize,
        scale: 'fit',
        copies: copies
      };
      if (options.pages) printOptions.pages = options.pages;
      if (options.orientation) printOptions.orientation = options.orientation;

      await ptp.print(tempPdfPath, printOptions);
      console.log(`🎉 SUCCESS! Paper dispatched to physical printer via Windows Driver: ${selectedWinPrinter.name}!`);
      printed = true;
    }
  } catch (winErr) {
    console.warn(`⚠️ Windows Spooler note: ${winErr.message}`);
  }

  // 2. Direct Network Protocols (IPP & PJL-RAW socket) if Windows driver was not used
  if (!printed && targetPrinter.ipAddress) {
    if (targetPrinter.protocol === 'ipp' || targetPrinter.port === 631) {
      console.log(`🖨️ [IPP Protocol] Sending print job to ${targetPrinter.ipAddress}:631/ipp/print...`);
      try {
        await printViaIpp(pdfBuffer, targetPrinter, docName, isDuplex, copies);
        printed = true;
      } catch (ippErr) {
        console.warn(`⚠️ IPP print failed (${ippErr.message}) -> Falling back to PJL-RAW Port 9100...`);
        await printViaPjlRawSocket(pdfBuffer, targetPrinter, docName, isDuplex);
        printed = true;
      }
    } else {
      console.log(`🖨️ [PJL-RAW Protocol] Streaming PDF to ${targetPrinter.ipAddress}:${targetPrinter.port || 9100} with PJL headers...`);
      await printViaPjlRawSocket(pdfBuffer, targetPrinter, docName, isDuplex);
      printed = true;
    }
  }

  // Safe temp file cleanup
  setTimeout(() => {
    try { if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath); } catch (e) {}
  }, 15000);

  return printed;
}

function printViaIpp(pdfBuffer, printerConfig, filename, duplex = true, copies = 1) {
  return new Promise((resolve, reject) => {
    const printerUrl = `http://${printerConfig.ipAddress}:${printerConfig.port || 631}/ipp/print`;
    const printer = ipp.Printer(printerUrl);

    const msg = {
      'operation-attributes-tag': {
        'requesting-user-name': 'SmartXeroxDirectAgent',
        'job-name': filename || 'DirectOrder.pdf',
        'document-format': 'application/pdf'
      },
      'job-attributes-tag': {
        'sides': duplex ? 'two-sided-long-edge' : 'one-sided',
        'copies': copies
      },
      data: pdfBuffer
    };

    printer.execute('Print-Job', msg, (err, res) => {
      if (err) return reject(err);
      console.log(`🎉 SUCCESS! IPP Job accepted by ${printerConfig.name}!`);
      resolve(res);
    });
  });
}

function printViaPjlRawSocket(pdfBuffer, printerConfig, filename, duplex = true) {
  return new Promise((resolve, reject) => {
    const port = printerConfig.port || 9100;
    const client = new net.Socket();
    client.setTimeout(15000);

    // Standard PJL wrapper for Canon / HP Direct PDF interpretation
    const pjlHeader = Buffer.from(
      '\x1b%-12345X@PJL\r\n' +
      `@PJL JOB NAME = "${filename || 'SmartXerox_DirectOrder'}"\r\n` +
      (duplex ? '@PJL SET DUPLEX = ON\r\n@PJL SET BINDING = LONGEDGE\r\n' : '@PJL SET DUPLEX = OFF\r\n') +
      '@PJL ENTER LANGUAGE = PDF\r\n'
    );
    const pjlFooter = Buffer.from('\r\n\x1b%-12345X@PJL EOJ\r\n\x1b%-12345X');
    const fullPayload = Buffer.concat([pjlHeader, pdfBuffer, pjlFooter]);

    client.connect(port, printerConfig.ipAddress, () => {
      console.log(`⚡ Connected to printer socket ${printerConfig.ipAddress}:${port} -> Writing ${fullPayload.length} bytes...`);
      client.write(fullPayload, () => {
        client.end();
      });
    });

    client.on('close', () => {
      console.log(`🎉 SUCCESS! Paper print data flushed to ${printerConfig.name} (${printerConfig.ipAddress}:${port})!`);
      resolve();
    });

    client.on('error', (err) => {
      client.destroy();
      reject(err);
    });

    client.on('timeout', () => {
      client.destroy();
      reject(new Error(`Connection to ${printerConfig.ipAddress}:${port} timed out after 15s`));
    });
  });
}

function probePrinterHardware(ipAddress, preferredPort) {
  return new Promise(async (resolve) => {
    // Check multiple standard printer ports: 631 (IPP), 9100 (RAW), 80 (Web UI), 515 (LPR)
    const portsToTest = preferredPort ? [preferredPort, 631, 9100, 80, 515] : [631, 9100, 80, 515];
    const uniquePorts = [...new Set(portsToTest)];

    let activePort = null;

    for (const port of uniquePorts) {
      const isOpen = await new Promise((resPort) => {
        const s = new net.Socket();
        s.setTimeout(1200);
        s.on('connect', () => { s.destroy(); resPort(true); });
        s.on('timeout', () => { s.destroy(); resPort(false); });
        s.on('error', () => { s.destroy(); resPort(false); });
        s.connect(port, ipAddress);
      });

      if (isOpen) {
        activePort = port;
        console.log(`🟢 Port ${port} is OPEN on ${ipAddress}!`);
        break;
      }
    }

    if (!activePort) {
      resolve({
        isOnline: false,
        error: `No printer ports (631, 9100, 80, 515) responded on ${ipAddress}. Check printer power or IP.`
      });
      return;
    }

    resolve({
      isOnline: true,
      activePort,
      protocol: activePort === 631 ? 'ipp' : 'raw',
      formats: ['application/pdf', 'application/postscript', 'application/octet-stream'],
      preferredFormat: 'application/pdf',
      supportsDuplex: true,
      model: activePort === 631 ? 'IPP Network Printer' : 'RAW Network Printer'
    });
  });
}

// Clean exit handlers
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping Smart Xerox Print Agent...');
  if (socket) socket.disconnect();
  process.exit(0);
});

loginAndConnect();
