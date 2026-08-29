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

  socket.on('order:accepted', handlePrintJob);
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

async function handlePrintJob(orderData) {
  try {
    const orderId = orderData.orderId || orderData._id;
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

    for (const doc of (order.documents || [])) {
      const fileUrl = doc.fileUrl || doc.url;
      if (!fileUrl) continue;

      console.log(`⬇️ Downloading PDF Stream: ${doc.originalName}...`);
      const pdfBuffer = await downloadFile(fileUrl);

      const isColor = doc.printingRanges?.some(r => r.colorMode === 'color');
      const targetPrinter = config.printers.find(p => isColor ? p.type === 'color' : p.type === 'bw') || config.printers[0];

      console.log(`🖨️ AUTO-PRINTING ➔ Streaming to ${targetPrinter.name} (${targetPrinter.ipAddress}:9100)...`);

      if (targetPrinter.protocol === 'ipp') {
        await printViaIpp(pdfBuffer, targetPrinter, doc.originalName);
      } else {
        await printViaRawSocket(pdfBuffer, targetPrinter);
      }

      console.log(`🎉 SUCCESS! Paper printed directly from ${targetPrinter.name}!`);
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

function printViaIpp(pdfBuffer, printerConfig, filename) {
  return new Promise((resolve, reject) => {
    const printerUrl = `http://${printerConfig.ipAddress}:${printerConfig.port || 631}/ipp/print`;
    const printer = ipp.Printer(printerUrl);

    const msg = {
      'operation-attributes-tag': {
        'requesting-user-name': 'SmartXeroxDirectAgent',
        'job-name': filename || 'DirectOrder.pdf',
        'document-format': 'application/pdf'
      },
      data: pdfBuffer
    };

    printer.execute('Print-Job', msg, (err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
}

function printViaRawSocket(pdfBuffer, printerConfig) {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const client = net.connect({ host: printerConfig.ipAddress, port: printerConfig.port || 9100 }, () => {
      client.write(pdfBuffer);
      client.end();
      resolve();
    });

    client.on('error', (err) => reject(err));
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
