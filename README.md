# Smart Xerox - IPP-Based Printing Platform

## 🚀 Overview

Smart Xerox is a comprehensive cloud-based printing platform that enables customers to upload documents, make payments, and collect prints from local print shops. The system uses **Internet Printing Protocol (IPP)** for direct network printing over VPN connections.

## 📋 Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Configuration](#environment-configuration)
- [Deployment](#deployment)
- [Security](#security)
- [API Documentation](#api-documentation)
- [Troubleshooting](#troubleshooting)

## ✨ Features

### Customer Features
- 📄 Document upload (PDF, images)
- 💳 Razorpay payment integration
- 🔐 OTP-based pickup verification
- 📱 Real-time order tracking via Socket.IO
- 🎨 Color/B&W selection per page range
- 📋 Multiple print options (copies, sides, paper size)

### Shop Owner Features
- 🖨️ Manual IPP printer configuration
- ⚖️ Smart load balancing across printers
- 📊 Real-time dashboard with order queue
- 💰 Payment management and reconciliation
- 🔔 Push notifications for new orders

### Admin Features
- 🛡️ Security monitoring and threat detection
- 📈 Analytics and reporting
- 👥 User and shop management
- 🏦 Payment reconciliation tools

## 🏗️ Architecture

### Backend Stack
- **Runtime**: Node.js 18+ with Express.js
- **Database**: MongoDB (Atlas recommended)
- **File Storage**: AWS S3
- **Payment**: Razorpay
- **Real-time**: Socket.IO
- **Printing**: IPP (Internet Printing Protocol)
- **Security**: Helmet, CORS, Rate Limiting, XSS Protection

### Frontend Stack
- **Framework**: React 18 with Vite
- **UI**: TailwindCSS + Radix UI
- **State**: React Query (TanStack Query)
- **Routing**: React Router v6

### Printing Architecture
```
Customer → Backend → S3 → IPP Service → Printer (VPN IP)
                ↓
           OTP Stamping
```

## 📦 Prerequisites

### Required Software
- Node.js >= 18.0.0
- MongoDB 4.4+
- AWS Account (S3 bucket)
- Razorpay Account (for payments)
- VPN setup for printer access (Tailscale/ZeroTier recommended)

### Required Accounts
1. **MongoDB Atlas** (or self-hosted MongoDB)
2. **AWS S3** for document storage
3. **Razorpay** for payment processing
4. **Brevo** (formerly Sendinblue) for transactional emails
5. **Optional**: Sentry for error tracking

## 🔧 Installation

### Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Generate secure secrets
npm run security:generate-secrets

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env

# Run security audit
npm run security:check

# Start development server
npm run dev

# Or start production server
npm start
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with backend URL
nano .env

# Start development server
npm run dev

# Build for production
npm run build
```

## 🔐 Environment Configuration

### Backend Environment Variables

#### Required Variables

```bash
# Server
NODE_ENV=production
PORT=5000

# Database
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/db

# JWT Secrets (Generate with: npm run security:generate-secrets)
JWT_SECRET=<64+ character hex string>
JWT_REFRESH_SECRET=<64+ character hex string>
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# AWS S3
AWS_ACCESS_KEY_ID=<your-aws-key>
AWS_SECRET_ACCESS_KEY=<your-aws-secret>
AWS_REGION=ap-south-1
AWS_S3_BUCKET=<your-bucket-name>

# Razorpay
RAZORPAY_KEY_ID=<rzp_live_...>
RAZORPAY_KEY_SECRET=<your-secret>
RAZORPAY_WEBHOOK_SECRET=<webhook-secret>

# Frontend URL (for CORS)
FRONTEND_URL=https://your-domain.com

# Email (Brevo SMTP)
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=2525
SMTP_USER=<your-brevo-email>
SMTP_PASS=<your-brevo-api-key>
EMAIL_FROM=noreply@yourdomain.com
```

#### Optional Variables

```bash
# Redis (for multi-instance deployments)
REDIS_URL=redis://localhost:6379

# Security
ENCRYPTION_KEY=<32-character hex string>
ADMIN_IP_WHITELIST=1.2.3.4,5.6.7.8
BLOCKED_COUNTRIES=CN,RU,KP

# Monitoring
SENTRY_DSN=<your-sentry-dsn>
HEALTH_CHECK_SECRET=<random-string>

# IPP Configuration
IPP_REQUEST_TIMEOUT_MS=20000
```

### Frontend Environment Variables

```bash
# API Configuration
VITE_API_URL=https://your-backend-domain.com/api
VITE_SOCKET_URL=https://your-backend-domain.com

# Razorpay (LIVE key for production)
VITE_RAZORPAY_KEY=rzp_live_<your-key>

# Optional
VITE_GOOGLE_ANALYTICS_ID=
VITE_SENTRY_DSN=
VITE_ENABLE_ANALYTICS=true
```

## 🚀 Deployment

### Backend Deployment (Render/Railway/Vercel)

1. **Connect Git Repository**
2. **Set Environment Variables** (from above list)
3. **Configure Build Command**: `npm install`
4. **Configure Start Command**: `npm start`
5. **Set Node Version**: 18.x or higher

### Frontend Deployment (Vercel/Netlify)

1. **Connect Git Repository**
2. **Set Root Directory**: `frontend`
3. **Build Command**: `npm run build`
4. **Output Directory**: `dist`
5. **Set Environment Variables** (VITE_*)

### VPN Setup for IPP Printing

#### Option 1: Tailscale (Recommended)
```bash
# Install Tailscale on shop computer
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# Note the Tailscale IP (e.g., 100.x.x.x)
# Use this IP in printer configuration
```

#### Option 2: ZeroTier
```bash
# Install ZeroTier
curl -s https://install.zerotier.com | sudo bash

# Join network
zerotier-cli join <network-id>
```

### Printer Configuration

1. **Connect printer to VPN** (Tailscale/ZeroTier)
2. **Find printer's VPN IP address**
3. **Add printer in dashboard**: Settings → Printers → Add Manual Printer
4. **Test print** with a sample document

## 🔒 Security

### Production Security Checklist

- ✅ Rotate all default secrets (`JWT_SECRET`, `ENCRYPTION_KEY`)
- ✅ Use HTTPS only (enforce in server.js)
- ✅ Enable Redis for distributed rate limiting
- ✅ Configure `ADMIN_IP_WHITELIST` for admin routes
- ✅ Set up Sentry for error tracking
- ✅ Configure CSP headers (already in server.js)
- ✅ Enable HSTS with preload
- ✅ Use AWS IAM roles instead of access keys (if on AWS)
- ✅ Enable MongoDB authentication and IP whitelist
- ✅ Set up firewall rules for printer VPN

### Security Features

1. **Authentication**
   - JWT with automatic token rotation
   - Refresh token mechanism
   - Account lockout after failed attempts
   - Email-based account recovery

2. **Payment Security**
   - Razorpay signature verification
   - Idempotency keys for duplicate prevention
   - Amount validation before payment capture
   - Webhook replay attack prevention

3. **API Security**
   - Helmet.js for HTTP headers
   - CORS with strict origin checking
   - Rate limiting (per-IP, per-route)
   - XSS and NoSQL injection protection
   - CSRF token validation
   - Request signature validation for critical operations

4. **Data Security**
   - MongoDB sanitization
   - Input validation with express-validator
   - File type and size validation
   - OTP encryption at rest
   - Audit logging for sensitive operations

## 📚 API Documentation

### Authentication Endpoints

```
POST /api/auth/register          - Register new user
POST /api/auth/login             - Login with email/password
POST /api/auth/logout            - Logout current session
POST /api/auth/refresh-token     - Get new access token
POST /api/auth/send-otp          - Send OTP for phone verification
POST /api/auth/verify-otp        - Verify phone OTP
```

### Order Endpoints

```
POST /api/orders                 - Create new order
GET /api/orders                  - Get user's orders
GET /api/orders/:id              - Get order details
PATCH /api/orders/:id/cancel     - Cancel order
```

### Shop Endpoints

```
GET /api/shops                   - Get nearby shops
GET /api/shops/:id               - Get shop details
GET /api/shops/:id/orders        - Get shop orders (shopkeeper only)
```

### Payment Endpoints

```
POST /api/payments/verify        - Verify Razorpay payment
POST /api/payments/webhook       - Razorpay webhook handler
```

### Printer Endpoints

```
GET /api/printers                - Get shop printers
POST /api/printers/register      - Register printers (agent)
POST /api/printers/manual        - Add manual IPP printer
PATCH /api/printers/:id/toggle   - Enable/disable printer
PATCH /api/printers/:id/name     - Update display name
```

### Upload Endpoints

```
POST /api/upload                 - Upload document
GET /api/upload/:key/url         - Get pre-signed download URL
```

## 🔍 Troubleshooting

### Common Issues

#### 1. Printer Not Connecting

**Symptoms**: IPP timeout errors in logs

**Solutions**:
- Verify printer VPN IP address is correct
- Check printer is powered on and connected to VPN
- Test network connectivity: `ping <printer-ip>`
- Verify firewall allows port 631 (IPP)
- Check printer supports IPP protocol

#### 2. Payment Verification Fails

**Symptoms**: "Invalid signature" errors

**Solutions**:
- Verify `RAZORPAY_KEY_SECRET` matches dashboard
- Check webhook secret is configured
- Ensure frontend sends amount in paise (multiply by 100)
- Check Razorpay webhook logs for delivery failures

#### 3. File Upload Fails

**Symptoms**: 500 error on document upload

**Solutions**:
- Verify AWS credentials are correct
- Check S3 bucket exists and has correct permissions
- Verify bucket region matches `AWS_REGION`
- Check file size is under limit (default: 50MB)

#### 4. Socket.IO Not Connecting

**Symptoms**: Real-time updates not working

**Solutions**:
- Verify `VITE_SOCKET_URL` in frontend .env
- Check CORS allows your frontend origin
- Enable WebSocket support in proxy/load balancer
- Check Redis is running (for multi-instance deployments)

#### 5. MongoDB Connection Fails

**Symptoms**: "MongoServerError" on startup

**Solutions**:
- Verify `MONGODB_URI` connection string
- Check IP address is whitelisted in MongoDB Atlas
- Verify database user has correct permissions
- Test connection with MongoDB Compass

### Debug Mode

Enable detailed logging:

```bash
# Backend
LOG_LEVEL=debug npm start

# Frontend
VITE_DEBUG=true npm run dev
```

### Health Check

```bash
# Check backend health
curl https://your-backend.com/health

# With detailed metrics (requires HEALTH_CHECK_SECRET)
curl -H "x-health-secret: YOUR_SECRET" https://your-backend.com/health
```

## 📊 Monitoring

### Application Logs

Backend logs are stored in `backend/logs/`:
- `application-YYYY-MM-DD.log` - General application logs
- `error-YYYY-MM-DD.log` - Error logs only

### Health Metrics

The `/health` endpoint provides:
- Server uptime
- Memory usage (heap/RSS)
- Database connection status
- Redis connection status (if enabled)
- Circuit breaker status

### Performance Monitoring

- Use Sentry for error tracking
- Monitor MongoDB slow queries
- Set up alerts for high memory usage
- Track API response times

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is proprietary software. All rights reserved.

## 🆘 Support

For technical support:
- **Email**: support@smartxerox.com
- **Documentation**: [docs.smartxerox.com](https://docs.smartxerox.com)
- **Issue Tracker**: GitHub Issues

## 🎯 Roadmap

### Q1 2026
- [ ] Automatic printer discovery via mDNS
- [ ] Mobile app (React Native)
- [ ] WhatsApp notifications

### Q2 2026
- [ ] Multi-language support
- [ ] Invoice generation
- [ ] Bulk order discounts

### Q3 2026
- [ ] Subscription plans for businesses
- [ ] Advanced analytics dashboard
- [ ] API webhooks for third-party integrations

---

**Built with ❤️ by Smart Xerox Team**
