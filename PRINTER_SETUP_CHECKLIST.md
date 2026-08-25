# ✅ Printer Setup Checklist

Use this checklist to connect your first printer to the deployed system.

---

## Before You Start

- [ ] Backend deployed and accessible at: `https://___________________`
- [ ] Frontend deployed and accessible at: `https://___________________`
- [ ] Shopkeeper account created
- [ ] Logged in as shopkeeper
- [ ] Printer is powered on and connected to network

---

## Step 1: Find Printer IP Address

### Windows:
```cmd
ping PRINTER_NAME
```
- [ ] Got reply with IP address: `___________________`

### macOS:
```bash
system_profiler SPPrintersDataType | grep "Print Server"
```
- [ ] Found printer IP: `___________________`

### Linux:
```bash
lpstat -v
```
- [ ] Found printer IP: `___________________`

**My Printer IP:** `___________________`

---

## Step 2: Test Printer Connection

### Test Port 631 (IPP Default Port)

**Windows PowerShell:**
```powershell
Test-NetConnection -ComputerName YOUR_PRINTER_IP -Port 631
```

**macOS/Linux:**
```bash
nc -zv YOUR_PRINTER_IP 631
```

- [ ] Connection successful (TcpTestSucceeded: True)
- [ ] Port 631 is open

**If connection fails:**
- [ ] Checked printer is on same network
- [ ] Checked firewall allows port 631
- [ ] Pinged printer successfully: `ping YOUR_PRINTER_IP`

---

## Step 3: Determine Printer Type

**Is your printer color or black & white?**

- [ ] Black & White (B&W) → Use type: `bw`
- [ ] Color → Use type: `color`

**My Printer Type:** `___________________`

---

## Step 4: Add Printer to System

### Method A: Via Dashboard (Recommended)

1. **Login**
   - [ ] Opened frontend URL in browser
   - [ ] Logged in with shopkeeper credentials

2. **Navigate to Printers**
   - [ ] Clicked "Shop Dashboard" or "Manage Shop"
   - [ ] Clicked "Printers" tab

3. **Add Printer**
   - [ ] Clicked "Add Manual Printer" or "+ Add Printer"
   - [ ] Filled form:
     - Name: `___________________`
     - Type: `___________________` (bw or color)
     - IP Address: `___________________`
   - [ ] Clicked "Save" or "Add Printer"

4. **Verify**
   - [ ] Printer appears in list
   - [ ] Status shows "Running" (green indicator)
   - [ ] Last Seen shows recent timestamp

### Method B: Via API (Alternative)

```bash
# Get your auth token from browser DevTools → Application → Local Storage → "token"

curl -X POST "https://YOUR_BACKEND_URL/api/printers/manual" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "name": "PRINTER_NAME",
    "type": "bw",
    "ipAddress": "PRINTER_IP"
  }'
```

- [ ] Got success response: `{ "success": true, ... }`
- [ ] Printer added successfully

---

## Step 5: Test Print Job

### Place Test Order

1. **As Customer:**
   - [ ] Logged out from shopkeeper account
   - [ ] Created new customer account (or used existing)
   - [ ] Uploaded a test PDF (1-2 pages)
   - [ ] Selected your shop
   - [ ] Configured print settings (B&W, single-sided, 1 copy)
   - [ ] Placed order
   - [ ] Completed payment (use test mode if configured)

2. **As Shopkeeper:**
   - [ ] Logged back in as shopkeeper
   - [ ] Navigated to "Orders" or "Shop Dashboard"
   - [ ] Found the new test order (status: "Paid")
   - [ ] Clicked "Accept Order"
   - [ ] Order status changed to "Printing"

3. **Verify Physical Print:**
   - [ ] Printer received print job
   - [ ] Document printed successfully
   - [ ] Order status changed to "Ready"
   - [ ] Pickup OTP generated

---

## Step 6: Monitor & Verify

### Check Dashboard

- [ ] Printer shows in printer list
- [ ] Status: "Running" (not "Offline")
- [ ] Last Seen: Recent timestamp (< 5 minutes)
- [ ] Current Load: Shows page count
- [ ] Jobs in Queue: Shows job count

### Check Backend Logs

- [ ] Backend logs show: `✅ [IPP] Order #XXXX completed via IPP`
- [ ] No error messages about printer connectivity
- [ ] IPP connection successful

---

## Troubleshooting

### Issue: Printer shows "Offline"

- [ ] Verified printer is powered on
- [ ] Pinged printer: `ping PRINTER_IP`
- [ ] Tested port: `nc -zv PRINTER_IP 631`
- [ ] Checked printer is on same network as backend
- [ ] Checked firewall rules allow port 631

**Solution:** `___________________`

### Issue: "IPP Request Timeout"

- [ ] Checked network latency: `ping -n 10 PRINTER_IP`
- [ ] Verified printer supports IPP protocol
- [ ] Increased timeout in backend .env: `IPP_REQUEST_TIMEOUT_MS=30000`

**Solution:** `___________________`

### Issue: Order stuck in "Printing"

- [ ] Checked printer for paper jam
- [ ] Checked printer error lights
- [ ] Cleared printer queue via printer web interface
- [ ] Clicked "Resume Print" in order details

**Solution:** `___________________`

---

## Success Criteria ✅

Your printer setup is complete when:

- [x] Printer appears in dashboard with "Running" status
- [x] Test order placed successfully
- [x] Order accepted by shopkeeper
- [x] Physical printout received at printer
- [x] Order status changed to "Ready"
- [x] Backend logs show successful IPP completion

---

## Additional Printers

Need to add more printers? Repeat Steps 1-6 for each printer.

**Printer 2:**
- [ ] IP: `___________________`
- [ ] Type: `___________________`
- [ ] Status: `___________________`

**Printer 3:**
- [ ] IP: `___________________`
- [ ] Type: `___________________`
- [ ] Status: `___________________`

---

## Support Resources

- **Full Guide:** See `PRINTER_CONNECTION_GUIDE.md`
- **Quick Reference:** See `QUICK_PRINTER_SETUP.txt`
- **Backend Logs:** Check `backend/logs/application-YYYY-MM-DD.log`
- **Error Logs:** Check `backend/logs/error-YYYY-MM-DD.log`

---

## Production Deployment Notes

For production use:

- [ ] Used VPN (Tailscale/WireGuard) for secure connection
- [ ] OR configured port forwarding with firewall rules
- [ ] Set up DHCP reservation for printer (fixed IP)
- [ ] Whitelisted backend server IP in firewall
- [ ] Documented printer network topology
- [ ] Set up monitoring/alerts for printer status

---

**Setup Date:** `___________________`  
**Completed By:** `___________________`  
**Status:** ☐ In Progress  ☐ Completed ✅  
**Notes:** `___________________`
