# Smart Xerox Printing Platform - Handover Documentation

This document serves as the comprehensive, detailed technical handover for the Smart Xerox Printing Platform. It covers the full architecture, directory structures, database schemas, core printing workflows, the Cloudflare zero-trust tunnel configuration, and resolution strategies for complex printing issues like the hardware duplex bug.

---

## 1. System Architecture & Tech Stack

The platform bridges a modern cloud-based web application with localized, on-premise hardware printers.

### **Frontend (`smart-xerox-frontend`)**
A Single Page Application (SPA) providing interfaces for end-users (students/customers) and shop owners.
- **Core Framework**: React.js 18, Vite.
- **Routing**: `react-router-dom` for client-side routing.
- **State Management**: `@tanstack/react-query` for server state, fetching, and caching; React Context for auth state.
- **Styling UI**: Tailwind CSS v3, Radix UI primitives, `framer-motion` for animations.
- **PDF Handling**: `pdfjs-dist` is heavily utilized on the client side to count pages and generate thumbnails *before* uploading, saving server bandwidth and processing power.
- **Real-time**: `socket.io-client` listens for print job status updates (e.g., printing, ready, failed).

### **Backend (`smart-xerox-backend`)**
A robust, highly concurrent Node.js server designed to securely manage files and dispatch network print jobs.
- **Core Framework**: Node.js, Express.js.
- **Database**: MongoDB (Mongoose ORM) for persistent data (Orders, Shops, Printers, Users).
- **Cache/PubSub**: Redis is used via `@socket.io/redis-adapter` to sync real-time socket events across multiple backend instances if scaled horizontally.
- **File Storage**: AWS S3. All files are uploaded directly to S3; the backend retrieves them temporarily during the print phase.
- **Print Engine**: 
  - `ipp` (Internet Printing Protocol): Dispatches raw byte payloads to network printers over port 631.
  - `ghostscript` (`gswin64c`/`gs`): Performs heavy-lifting conversion from PDF to PostScript/PCL for legacy printers.
  - `pdf-lib` & `jimp`: Image processing, packing images into A4 PDFs, and stamping security OTPs.

---

## 2. Directory Structure

### **Backend Directory (`smart-xerox-backend`)**
- `config/`: System configurations (AWS S3, Database connection, Logger, Socket.io initialization).
- `controllers/`: Request handlers for API routes (e.g., `printer.controller.js`, `order.controller.js`).
- `models/`: Mongoose schemas.
  - `Order.js`: The central entity. Tracks pricing, page ranges, duplex settings, file S3 keys, and the `printJob` status.
  - `Printer.js`: Tracks physical printers, their IP address, current load queue, supported MIME formats, and online status.
  - `Shop.js`: Shop configuration, location, pricing parameters, and owner references.
- `routes/`: Express route definitions mapped to controllers.
- `services/`: Core business logic decoupled from HTTP.
  - `ippPrint.service.js`: The heart of the platform. Handles downloading from S3, applying Ghostscript/PJL, and IPP dispatch.
  - `orderDispatch.service.js`: Load balancer. Finds the optimal printer for an order based on type (Color vs B&W) and queue length.
- `utils/`: Helpers like `ghostscript.js` (spawns child processes to run GS binaries) and `pricing.js`.

---

## 3. The Print Pipeline (Deep Dive)

When an order is marked as paid and ready for printing, it enters a highly fault-tolerant pipeline.

### **Step 1: Load Balancing & Dispatch (`orderDispatch.service.js`)**
1. Analyzes the order to determine if it requires Color or B&W.
2. If an order mixes Color and B&W pages, the system *divides* the order into sub-orders to route pages to the appropriate, cost-effective printers.
3. Queries `Printer.find()` to locate online, enabled printers belonging to the shop.
4. Selects the optimal printer by calculating a score: `(normalizedWait * 0.5) + (normalizedQueue * 0.3)`.

### **Step 2: Pre-Processing (`ippPrint.service.js`)**
1. **Download**: The document is streamed from AWS S3 into memory.
2. **Image Normalization**: If the user uploaded a JPEG/PNG, `jimp` normalizes the resolution, and `pdf-lib` embeds it into a standardized A4 PDF wrapper. (Prevents scale-to-fit errors on printers).
3. **Security Stamping**: `stampOTPOnPDF` uses `pdf-lib` to draw the user's pickup code/OTP directly onto the first page of the PDF buffer.

### **Step 3: Format Negotiation & Conversion**
1. The backend checks the printer's `supportedFormats` (which were auto-detected upon printer registration via an IPP `Get-Printer-Attributes` query).
2. **Native PDF**: If `application/pdf` is supported, the payload remains a PDF.
3. **Ghostscript Fallback**: If the printer lacks PDF support (common on cheaper Canon/Xerox machines), `utils/ghostscript.js` is invoked. A child process runs the `gs` binary to convert the PDF buffer into `application/postscript` (ps2write) or `application/vnd.hp-PCL` (pxlcolor). Ghostscript arguments for duplex (`-dDuplex=true`) are injected based on the user's requested page range settings.

### **Step 4: Hardware Enforcements (PJL Wrapper)**
Modern enterprise printers often have a firmware quirk where they accept native PDFs but completely ignore IPP layout tags (like `sides` for duplexing).
- To bypass this, the final byte buffer (PDF, PS, or PCL) is forcefully wrapped in **PJL (Printer Job Language)**.
- PJL intercepts the hardware controller *before* the file is parsed.
```text
<Escape>%-12345X@PJL JOB\r\n
@PJL SET DUPLEX=ON\r\n
@PJL SET BINDING=LONGEDGE\r\n
@PJL ENTER LANGUAGE=PDF\r\n
[... raw byte stream ...]
<Escape>%-12345X@PJL EOJ\r\n
<Escape>%-12345X
```
*Note: PJL strictly requires Carriage Return + Line Feed (`\r\n`). Standard `\n` will cause the printer to print the raw text instead of processing the command.*

### **Step 5: IPP Transmission**
The `node-ipp` library executes a `Print-Job` operation to the printer's URI.
- `job-attributes-tag`: Contains `copies` and `sides` (to satisfy strict IPP 1.1 specs).
- `operation-attributes-tag`: Contains `document-format` and `job-name`.
The job is sent over TCP/HTTP. If a network timeout occurs, exponential backoff retries are triggered.

---

## 4. Cloudflare Zero Trust Tunnel Setup

Physical printers reside on local area networks (LANs) behind NATs and Firewalls (e.g., `192.168.1.80`). The cloud backend cannot reach them directly. We utilize **Cloudflare Tunnels (`cloudflared`)** to bridge this gap securely.

### **Shop Configuration (Local Network)**
The shop owner installs `cloudflared` on a machine (PC or Raspberry Pi) residing on the same network as the printers.
1. Authenticate `cloudflared` to the Cloudflare account.
2. Create a tunnel: `cloudflared tunnel create shop-xerox-tunnel`
3. Map the local printer IP to a public hostname in the Cloudflare dashboard (or `config.yml`):
   ```yaml
   ingress:
     - hostname: printer1.shopdomain.com
       service: http://192.168.1.80:631
     - service: http_status:404
   ```
4. Run the tunnel: `cloudflared tunnel run shop-xerox-tunnel`

### **Security (Cloudflare Access)**
To prevent unauthorized internet users from printing to `printer1.shopdomain.com`, **Cloudflare Access** is applied to the hostname.
- Access Policy: Set to **Service Auth**.
- Generate a Service Token in Cloudflare.
- **Backend Configuration**: The backend `.env` file must contain:
  ```env
  CF_ACCESS_CLIENT_ID=your-service-token-id
  CF_ACCESS_CLIENT_SECRET=your-service-token-secret
  ```
- **Execution**: When `ippPrint.service.js` detects a `https://` printer URL, it automatically intercepts the `ipp` library's HTTP request and injects the `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers, seamlessly bypassing the Zero Trust wall and reaching the local printer.

---

## 5. The Duplex Printing Problem & Resolution

One of the most complex challenges during development was ensuring consistent double-sided (duplex) printing across fragmented printer ecosystems.

### **The Root Causes of Failure**
1. **Ignored IPP Attributes**: While the code correctly set `sides: 'two-sided-long-edge'` in the `job-attributes-tag`, many enterprise firmwares drop this tag when processing raw PDF bytes, defaulting to simplex.
2. **Ghostscript Stripping**: For legacy printers utilizing Ghostscript, the child process was originally generating simplex PostScript files, overriding the user's settings.
3. **Strict PJL Parsers**: Initial attempts to use PJL to force hardware duplexing failed because standard Unix line endings (`\n`) were used, causing hardware parsers to crash or ignore the command.

### **The Current, Bulletproof Implementation**
To guarantee duplex printing universally, three layers of enforcement were implemented in `ippPrint.service.js`:
1. **Ghostscript Pipeline**: Ghostscript execution was moved *inside* the `printingRanges` loop so duplex flags (`-dDuplex=true -dTumble=false`) could be dynamically applied to specific page ranges within a single document.
2. **Universal PJL Wrapper**: Before sending the final byte payload via IPP, the backend injects strict, CRLF (`\r\n`) formatted PJL commands around the payload, regardless of whether it's PDF, PostScript, or PCL. This forces the physical hardware to engage the duplexer *before* the file interpreter boots up.
3. **IPP Standard**: The `sides` tag remains correctly placed in the `job-attributes-tag` to satisfy strict IPP compliance checks for modern models that actually adhere to the specification.

---

## 6. Deployment & Environment Setup

### **Backend Startup Sequence**
1. **Prerequisites**: Node.js 18+, MongoDB, Redis, and Ghostscript (`gs`).
2. **Install**: `npm install`
3. **Env Vars**: Copy `.env.example` to `.env` and fill in AWS, Mongo, Redis, and Cloudflare credentials.
4. **Run**: `npm run start` (Production) or `npm run dev` (Development via Nodemon).

### **Frontend Startup Sequence**
1. **Prerequisites**: Node.js 18+.
2. **Install**: `npm install`
3. **Env Vars**: Create `.env` and set `VITE_API_URL` to the backend URL and `VITE_SOCKET_URL` to the socket server.
4. **Run**: `npm run build` (Compiles to static files in `dist/` for Nginx/Vercel) or `npm run dev` (Local Vite server).
