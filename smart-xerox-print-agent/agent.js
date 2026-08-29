const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ipp = require('ipp');
const { io } = require('socket.io-client');

let configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  configPath = path.join(__dirname, 'agent-config.json');
}

if (!fs.existsSync(configPath)) {
  console.error('❌ Missing config.json / agent-config.json file!');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const API_URL = config.apiUrl || 'https://api.pratibimb.online';

console.log('=====================================================');
console.log('🤖 SMART XEROX DIRECT SILENT PRINT AGENT (0 POPUPS)');
console.log('=====================================================');
console.log(`🌐 Server URL: ${API_URL}`);
console.log(`📧 Shopkeeper: ${config.shopkeeperEmail}`);
console.log(`🖨️ Silent Direct Network Printing: ACTIVE`);

let token = null;
let socket = null;

async function loginAndConnect() {
  try {
    console.log('\n🔑 Authenticating with Smart Xerox Cloud...');
    const res = await axios.post(`${API_URL}/api/auth/login`, {
      email: config.shopkeeperEmail,
      password: config.shopkeeperPassword
    });

    token = res.data.token || res.data.data?.token;
    console.log('✅ Connected & Authenticated!');

    connectWebSocket();
  } catch (err) {
    console.error('❌ Login Error:', err.response?.data?.message || err.message);
    setTimeout(loginAndConnect, 10000);
  }
}

function connectWebSocket() {
  console.log('📡 Listening for incoming student orders (0 Print Dialog Popups)...');

  socket = io(API_URL, {
    auth: { token },
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => {
    console.log('🟢 LIVE DIRECT PRINT ENGINE ACTIVE! Paper will feed out automatically when order is placed.');
  });

  // socket.on('order:accepted', handlePrintJob); // deduplicated
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

  socket.on('disconnect', () => {
    console.log('🔴 Disconnected! Reconnecting in 3 seconds...');
  });
}

const processedJobs = new Set();

async function handlePrintJob(orderData) {
  const orderId = (orderData.orderId || orderData._id)?.toString();
  if (!orderId) return;

  // Deduplication: prevent processing the exact same order multiple times concurrently
  if (processedJobs.has(orderId)) {
    return;
  }
  processedJobs.add(orderId);
  // Auto-expire after 2 minutes
  setTimeout(() => processedJobs.delete(orderId), 120000);

  try {
    console.log(`\n⚡ INCOMING ORDER #${orderData.orderNumber || orderId} RECEIVED!`);

    // 1. Notify Cloud Dashboard that printing has started (shows "Printing in Progress...")
    await axios.patch(`${API_URL}/api/orders/${orderId}/status`, { status: 'printing' }, {
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => {});

    const orderRes = await axios.get(`${API_URL}/api/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const order = orderRes.data.data?.order || orderRes.data.data;
    if (!order) return;

    // Fetch shop printers from cloud backend to get the exact live IP & settings
    const printersRes = await axios.get(`${API_URL}/api/printers/my-shop`, {
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => null);
    const shopPrinters = printersRes?.data?.data?.printers || printersRes?.data?.data || [];

        for (const doc of (order.documents || [])) {
      const fileUrl = doc.downloadUrl || doc.fileUrl || doc.url || doc.s3Url;
      if (!fileUrl) {
        console.warn(`⚠️ No download URL found for: ${doc.originalName || 'document'}`);
        continue;
      }

      console.log(`⬇️ Downloading PDF: ${doc.originalName}...`);
      const pdfBuffer = await downloadFile(fileUrl);

      // Extract accurate customer print options from order
      const isColor = doc.printingRanges ? doc.printingRanges.some(r => r.colorMode === 'color') : false;
      const isDoubleSided = doc.printingRanges ? doc.printingRanges.some(r => r.sides === 'double' || r.side === 'double') : (doc.duplex !== false);
      const copies = doc.printingRanges?.[0]?.copies || 1;
      const paperSize = doc.printingOptions?.paperSize || 'A4';
      
      let pageRangeStr = undefined;
      if (doc.printingRanges && doc.printingRanges.length > 0) {
        const r = doc.printingRanges[0];
        if (r.rangeStart && r.rangeEnd) {
          pageRangeStr = `${r.rangeStart}-${r.rangeEnd}`;
        }
      }
      
      let targetPrinter = null;
      if (order.assignedPrinter) {
        const assignedId = typeof order.assignedPrinter === 'object' ? order.assignedPrinter._id : order.assignedPrinter;
        targetPrinter = shopPrinters.find(p => p._id.toString() === assignedId.toString());
      }
      if (!targetPrinter && orderData.printer) {
        targetPrinter = orderData.printer;
      }
      if (!targetPrinter) {
        targetPrinter = shopPrinters.find(p => isColor ? p.type === 'color' : p.type === 'bw') || shopPrinters[0];
      }
      if (!targetPrinter && config.printers && config.printers.length > 0) {
        targetPrinter = config.printers.find(p => isColor ? p.type === 'color' : p.type === 'bw') || config.printers[0];
      }

      if (!targetPrinter) {
        targetPrinter = { name: 'Default Printer', ipAddress: '192.168.1.80', port: 9100, protocol: 'raw' };
      }

      console.log(`🖨️ SENDING TO PRINTER ➔ ${targetPrinter.displayName || targetPrinter.name} (IP: ${targetPrinter.ipAddress || 'Windows Driver'}) | Duplex: ${isDoubleSided ? 'DOUBLE-SIDED (Back-to-Back)' : 'SINGLE-SIDED'} | Copies: ${copies}...`);

      await printDocument(pdfBuffer, targetPrinter, doc.originalName, {
        duplex: isDoubleSided,
        monochrome: !isColor,
        paperSize: paperSize,
        copies: copies,
        pages: pageRangeStr
      });
    }

    // 2. Mark order as READY for pickup on Dashboard (shows "Ready for Pickup")
    await axios.patch(`${API_URL}/api/orders/${orderId}/status`, { status: 'ready' }, {
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => {});

    console.log(`✅ Order #${order.orderNumber || orderId} marked READY for pickup on Dashboard!`);

  } catch (err) {
    console.error('❌ Direct Print Error:', err.message);
  }
}

function downloadFile(url) {
  return axios.get(url, { responseType: 'arraybuffer' }).then(res => Buffer.from(res.data));
}

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

  // 1. Try Windows Spooler (100% reliable hardware driver rendering on Windows)
  try {
    const ptp = require('pdf-to-printer');
    const winPrinters = await ptp.getPrinters().catch(() => []);
    
    let selectedWinPrinter = winPrinters.find(p => 
      p.name?.toLowerCase().includes(targetPrinter.name?.toLowerCase()) ||
      p.deviceId?.toLowerCase().includes(targetPrinter.name?.toLowerCase())
    );

    if (!selectedWinPrinter) {
      selectedWinPrinter = winPrinters.find(p => {
        const n = p.name.toLowerCase();
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
      await ptp.print(tempPdfPath, printOptions);
      console.log(`🎉 SUCCESS! Paper dispatched to physical printer via Windows Driver: ${selectedWinPrinter.name}!`);
      printed = true;
    }
  } catch (winErr) {
    console.warn(`⚠️ Windows Spooler note: ${winErr.message}`);
  }

  // 2. Direct Network Protocols (IPP & PJL-RAW socket)
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

  setTimeout(() => {
    try { if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath); } catch (e) {}
  }, 15000);

  return printed;
}

function printViaIpp(pdfBuffer, printerConfig, filename, duplex = true) {
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
        'copies': 1
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
    const net = require('net');
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

loginAndConnect();

function probePrinterHardware(ipAddress, preferredPort) {
  return new Promise(async (resolve) => {
    const net = require('net');
    
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

    // If port 631 or 80 is open, query IPP attributes
    const printerUrl = `http://${ipAddress}:${activePort === 9100 ? 631 : activePort}/ipp/print`;
    const printer = ipp.Printer(printerUrl);

    const msg = {
      'operation-attributes-tag': {
        'requesting-user-name': 'SmartXeroxProbe',
        'attributes-charset': 'utf-8',
        'attributes-natural-language': 'en-us',
        'printer-uri': printerUrl,
        'requested-attributes': [
          'document-format-supported',
          'sides-supported',
          'printer-make-and-model',
          'printer-state'
        ]
      }
    };

    printer.execute('Get-Printer-Attributes', msg, (err, res) => {
      if (err || !res || !res['printer-attributes-tag']) {
        resolve({
          isOnline: true,
          activePort,
          protocol: activePort === 631 ? 'ipp' : 'raw',
          formats: ['application/pdf', 'application/postscript', 'application/octet-stream'],
          preferredFormat: 'application/pdf',
          supportsDuplex: true,
          model: activePort === 631 ? 'IPP Network Printer' : 'RAW Network Printer'
        });
        return;
      }

      const attrs = res['printer-attributes-tag'];
      const formats = Array.isArray(attrs['document-format-supported'])
        ? attrs['document-format-supported']
        : attrs['document-format-supported'] ? [attrs['document-format-supported']] : ['application/pdf'];

      const sides = attrs['sides-supported'] || [];
      const supportsDuplex = Array.isArray(sides)
        ? sides.some(s => s.includes('two-sided'))
        : typeof sides === 'string' && sides.includes('two-sided');

      const model = attrs['printer-make-and-model'] || 'Network Printer';

      resolve({
        isOnline: true,
        activePort,
        protocol: activePort === 631 ? 'ipp' : 'raw',
        formats,
        preferredFormat: formats.includes('application/pdf') ? 'application/pdf' : formats[0],
        supportsDuplex,
        model
      });
    });
  });
}
