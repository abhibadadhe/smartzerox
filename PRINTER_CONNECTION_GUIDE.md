# 🖨️ Printer Connection Guide for Deployed System

Complete step-by-step guide to connect physical printers to your deployed IPP-based xerox system.

---

## 📋 Prerequisites

Before starting, ensure you have:

1. ✅ **Backend deployed** and running (e.g., on Render, Railway, Heroku)
2. ✅ **Frontend deployed** and running (e.g., on Vercel, Netlify)
3. ✅ **Shopkeeper account** created and logged in
4. ✅ **Physical printer(s)** with IPP support (most modern printers)
5. ✅ **Printer on same network** OR publicly accessible IP/hostname

---

## 🔧 Method 1: Manual Printer Configuration (Recommended)

This is the **easiest and most reliable method** for connecting printers to your deployed system.

### Step 1: Find Your Printer's IP Address

#### Windows:
```powershell
# Open Command Prompt and run:
ping PRINTER_NAME

# OR check printer properties:
# Control Panel → Devices and Printers → Right-click printer → Printer Properties → Ports tab
```

#### macOS:
```bash
# Open Terminal and run:
system_profiler SPPrintersDataType | grep "Print Server"

# OR: System Preferences → Printers & Scanners → Select printer → Options & Supplies → Show Printer Webpage
```

#### Linux:
```bash
lpstat -v
# OR
avahi-browse -rt _ipp._tcp
```

**Example Output:**
```
IP Address: 192.168.1.100
```

### Step 2: Test IPP Connection

Test if your printer responds to IPP requests:

```bash
# Windows (PowerShell):
Test-NetConnection -ComputerName 192.168.1.100 -Port 631

# macOS/Linux:
nc -zv 192.168.1.100 631
```

**Expected output:**
```
Connection succeeded
Port 631 is open
```

### Step 3: Add Printer via Frontend Dashboard

1. **Login as Shopkeeper**
   - Go to your frontend URL: `https://your-frontend.vercel.app/login`
   - Login with shopkeeper credentials

2. **Navigate to Printers Section**
   - Click **"Shop Dashboard"** or **"Manage Shop"**
   - Click **"Printers"** tab or **"Printer Management"**

3. **Add New Printer**
   - Click **"Add Manual Printer"** or **"+ Add Printer"** button
   - Fill in the form:
     ```
     Printer Name: HP LaserJet Pro
     Printer Type: bw (for black & white) or color
     IP Address: 192.168.1.100
     ```
   - Click **"Add Printer"** or **"Save"**

4. **Verify Connection**
   - The printer should appear in your printer list
   - Status should show: **"Running"** or **"Online"**
   - If offline, check IP address and network connectivity

### Step 4: Add Printer via API (Alternative)

If your frontend doesn't have the UI yet, use API directly:

```bash
# Replace with your actual values:
export BACKEND_URL="https://your-backend.render.com"
export AUTH_TOKEN="your_jwt_token_here"

# Add printer via API:
curl -X POST "$BACKEND_URL/api/printers/manual" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "name": "HP LaserJet Pro",
    "type": "bw",
    "ipAddress": "192.168.1.100"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Printer added successfully",
  "data": {
    "printer": {
      "_id": "65abc123...",
      "name": "HP LaserJet Pro",
      "type": "bw",
      "ipAddress": "192.168.1.100",
      "status": "running",
      "isEnabled": true
    }
  }
}
```

---

## 🌐 Method 2: Public IP / Port Forwarding (For Remote Printers)

If your printer is behind a router/firewall and you want to access it remotely:

### Step 1: Enable Port Forwarding on Router

1. **Login to your router** (usually `192.168.1.1` or `192.168.0.1`)

2. **Find Port Forwarding settings**
   - Look for: "Port Forwarding", "Virtual Server", or "NAT"

3. **Add Port Forwarding Rule:**
   ```
   Service Name: IPP Printer
   External Port: 631 (or custom like 8631)
   Internal Port: 631
   Internal IP: 192.168.1.100 (your printer's local IP)
   Protocol: TCP
   ```

4. **Save and apply changes**

### Step 2: Get Your Public IP

```bash
# Find your public IP:
curl ifconfig.me
# OR
curl icanhazip.com
```

**Example:** `203.0.113.50`

### Step 3: Add Printer with Public IP

Add the printer using your **public IP** and forwarded port:

```
Printer Name: Remote HP Printer
Printer Type: bw
IP Address: 203.0.113.50:8631
```

⚠️ **Security Warning:** 
- This exposes your printer to the internet
- Use firewall rules to restrict access to your backend server IP only
- Consider using a VPN instead for better security

---

## 🔗 Method 3: VPN Connection (Most Secure)

For production deployments, use a VPN to connect your backend server to your local network.

### Option A: Tailscale (Easiest)

1. **Install Tailscale on your backend server:**
   ```bash
   # On your server (SSH into it):
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```

2. **Install Tailscale on your network** (where printer is):
   ```bash
   # On a computer in your printer's network:
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up --advertise-routes=192.168.1.0/24
   ```

3. **Accept routes** in Tailscale admin panel

4. **Use local IP in printer configuration:**
   ```
   IP Address: 192.168.1.100
   ```

### Option B: WireGuard VPN

1. **Setup WireGuard server** on your network
2. **Connect backend server** as WireGuard client
3. **Use local printer IP** (192.168.1.100)

---

## 🧪 Method 4: Testing with Local Network (Development)

For testing during development:

### Step 1: Expose Backend Locally

If your backend is deployed but you want to test with local printers:

```bash
# Option 1: Use ngrok to expose local backend
ngrok http 5000

# You'll get a URL like: https://abc123.ngrok.io
# Update your frontend VITE_API_URL to this URL
```

### Step 2: Add Local Printer

Add your local printer using its local IP:
```
IP Address: 192.168.1.100
```

---

## 📊 Verification Steps

After adding a printer, verify it's working:

### 1. Check Printer Status

**Via Frontend:**
- Go to **Printer Management** page
- Verify printer shows **"Running"** status
- Check **"Last Seen"** timestamp is recent

**Via API:**
```bash
curl -X GET "$BACKEND_URL/api/printers/my-shop" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

### 2. Test Print Job

1. **Place a test order** as a customer
2. **Accept the order** as shopkeeper
3. **Monitor backend logs** for IPP connection:
   ```
   🖨️ [IPP] Starting print job for Order #1234 to http://192.168.1.100:631/ipp/print
   ```

4. **Check printer** - it should receive and print the job

### 3. Check Logs

**Backend logs should show:**
```
✅ [IPP] Order #1234 completed via IPP
🖨️ Printer HP LaserJet Pro load decreased by 5 pages
```

**If errors occur:**
```
❌ [IPP] Order #1234 failed: IPP request timeout
```
→ Check IP address, network connectivity, and firewall

---

## 🔒 Security Best Practices

### 1. Firewall Configuration

**Allow only your backend server IP:**
```bash
# On your printer's network firewall:
# Allow: Backend Server IP (e.g., 34.123.45.67) → Printer IP:631
# Deny: All other sources → Printer IP:631
```

### 2. IP Whitelist (Recommended)

Add IP whitelist in your `.env`:
```bash
# Backend .env
PRINTER_IP_WHITELIST=192.168.1.0/24,10.0.0.0/8
```

### 3. Use HTTPS for IPP (if supported)

Some printers support IPPS (IPP over SSL):
```
IP Address: 192.168.1.100:443
```

---

## ❓ Troubleshooting

### Issue 1: Printer Shows "Offline"

**Causes:**
- Printer is powered off
- Wrong IP address
- Network connectivity issues
- Firewall blocking port 631

**Solutions:**
1. Ping the printer: `ping 192.168.1.100`
2. Check port: `nc -zv 192.168.1.100 631`
3. Verify IP address hasn't changed (use DHCP reservation)
4. Check firewall rules

### Issue 2: "IPP Request Timeout"

**Causes:**
- Printer doesn't support IPP
- Network latency too high
- Firewall blocking requests

**Solutions:**
1. Verify IPP support: `ipptool -tv ipp://192.168.1.100:631/ipp/print get-printer-attributes.test`
2. Increase timeout in `.env`: `IPP_REQUEST_TIMEOUT_MS=30000`
3. Check network latency: `ping -c 10 192.168.1.100`

### Issue 3: "No Printer Available"

**Causes:**
- All printers disabled
- No printer of required type (color/bw)
- Printer marked as offline

**Solutions:**
1. Check printer is enabled in dashboard
2. Verify printer type matches order (color order needs color printer)
3. Click "Refresh Printers" in dashboard

### Issue 4: Print Job Stuck in "Printing" Status

**Causes:**
- Printer paper jam
- Printer error state
- Network connection lost mid-print

**Solutions:**
1. Check printer physical status
2. Clear print queue on printer
3. Click "Resume Print" in order details
4. Or click "Retry Print" if failed

---

## 🎯 Quick Start Checklist

Use this checklist to connect your first printer:

- [ ] Backend deployed and running
- [ ] Frontend deployed and running
- [ ] Logged in as shopkeeper
- [ ] Found printer IP address (e.g., 192.168.1.100)
- [ ] Tested port 631 is open (`nc -zv IP 631`)
- [ ] Added printer via dashboard or API
- [ ] Printer shows "Running" status
- [ ] Placed test order
- [ ] Accepted order and verified print
- [ ] Printer received and printed document ✅

---

## 📞 Common Printer Types & IPP Support

Most modern printers support IPP. Here are common brands:

| Brand | IPP Support | Default Port | Notes |
|-------|-------------|--------------|-------|
| HP | ✅ Yes | 631 | Full IPP support on most models |
| Canon | ✅ Yes | 631 | Check "Network Printing" is enabled |
| Epson | ✅ Yes | 631 | Enable "IPP Printing" in web interface |
| Brother | ✅ Yes | 631 | Full support on network models |
| Xerox | ✅ Yes | 631 | Commercial models have full support |
| Samsung | ⚠️ Limited | 631 | Older models may not support IPP |
| Lexmark | ✅ Yes | 631 | Enterprise models fully supported |

**To enable IPP on most printers:**
1. Open printer's web interface: `http://PRINTER_IP`
2. Go to **Network Settings** or **Protocols**
3. Enable **IPP** or **Internet Printing Protocol**
4. Save and restart printer

---

## 🚀 Production Setup Example

Here's a complete real-world example:

### Network Setup:
```
Internet
    ↓
[Router: 203.0.113.50]
    ↓
    ├─ [Backend Server: Tailscale 100.64.1.10]
    ├─ [Print Server: Tailscale 100.64.1.20]
    └─ Local Network: 192.168.1.0/24
           ├─ HP Printer 1: 192.168.1.100 (B&W)
           ├─ Canon Printer 2: 192.168.1.101 (Color)
           └─ Brother Printer 3: 192.168.1.102 (B&W)
```

### Configuration:
```json
{
  "printers": [
    {
      "name": "HP LaserJet Pro M404n",
      "type": "bw",
      "ipAddress": "192.168.1.100"
    },
    {
      "name": "Canon PIXMA iX6850",
      "type": "color",
      "ipAddress": "192.168.1.101"
    },
    {
      "name": "Brother HL-L2350DW",
      "type": "bw",
      "ipAddress": "192.168.1.102"
    }
  ]
}
```

### Backend Environment:
```bash
# .env.production
IPP_REQUEST_TIMEOUT_MS=20000
IPP_BATCH_SIZE=5
MAX_ORDER_PAGES=10000
```

---

## 📚 API Reference

### Add Manual Printer
```http
POST /api/printers/manual
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Printer Name",
  "type": "bw" | "color",
  "ipAddress": "192.168.1.100"
}
```

### Get Shop Printers
```http
GET /api/printers/my-shop
Authorization: Bearer <token>
```

### Update Printer IP
```http
PATCH /api/printers/:printerId/ip
Authorization: Bearer <token>
Content-Type: application/json

{
  "ipAddress": "192.168.1.100"
}
```

### Toggle Printer Enable/Disable
```http
PATCH /api/printers/:printerId/toggle
Authorization: Bearer <token>
Content-Type: application/json

{
  "isEnabled": true | false
}
```

### Update Printer Display Name
```http
PATCH /api/printers/:printerId/display-name
Authorization: Bearer <token>
Content-Type: application/json

{
  "displayName": "Main Office Printer"
}
```

---

## 🎓 Advanced: Network Diagram

```
┌─────────────────────────────────────────────────────┐
│                   DEPLOYED SYSTEM                    │
├─────────────────────────────────────────────────────┤
│                                                       │
│  Frontend (Vercel)                                   │
│  https://xerox.vercel.app                           │
│         │                                            │
│         │ HTTPS/API                                  │
│         ▼                                            │
│  Backend (Render)                                    │
│  https://xerox-api.render.com                       │
│         │                                            │
│         │ IPP Protocol (HTTP/631)                    │
│         │ Via: VPN/Port Forward/Public IP            │
│         ▼                                            │
└─────────┼────────────────────────────────────────────┘
          │
          │ Internet
          │
┌─────────▼────────────────────────────────────────────┐
│                  YOUR LOCAL NETWORK                   │
├──────────────────────────────────────────────────────┤
│                                                       │
│  Router: 192.168.1.1                                 │
│    ├─ Port Forward: 631 → Printer                    │
│    └─ VPN: Tailscale/WireGuard                       │
│                                                       │
│  Printers:                                           │
│    ├─ HP Printer (B&W): 192.168.1.100:631           │
│    └─ Canon Printer (Color): 192.168.1.101:631      │
│                                                       │
└──────────────────────────────────────────────────────┘
```

---

## ✅ Success Confirmation

After setup, you should see:

**In Dashboard:**
- ✅ Printer shows in printer list
- ✅ Status: "Running"
- ✅ Last Seen: timestamp within last 2 minutes
- ✅ Load: 0 pages, 0 jobs in queue

**Test Order:**
- ✅ Order created successfully
- ✅ Payment verified
- ✅ Order accepted by shopkeeper
- ✅ Order status: "Printing" → "Ready"
- ✅ Physical printout received ✨

---

**Generated:** 2026-07-12  
**System:** Xerox-Agent IPP-based Printing Platform  
**Support:** Check logs at `backend/logs/` for detailed diagnostics
