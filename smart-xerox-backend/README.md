# Smart Xerox Printing Platform — Backend API

Production-grade Node.js + Express.js backend for the Smart Xerox Printing Platform.

---

## 🚀 Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ |
| Framework | Express.js |
| Database | MongoDB Atlas (Mongoose) |
| File Storage | AWS S3 |
| Payments | Razorpay |
| Real-time | Socket.IO |
| Auth | JWT + OTP |
| Deployment | Render / AWS EC2 |

---

## 📁 Project Structure

```
smart-xerox-backend/
├── server.js                   # Entry point
├── config/
│   ├── database.js             # MongoDB connection
│   ├── socket.js               # Socket.IO config
│   ├── logger.js               # Winston logger
│   ├── aws.js                  # S3 + Multer config
│   └── razorpay.js             # Razorpay config
├── models/
│   ├── User.js                 # User schema
│   ├── Shop.js                 # Shop schema (geospatial)
│   ├── Order.js                # Order schema
│   ├── Payment.js              # Payment schema
│   ├── Notification.js         # Notification schema
│   └── Review.js               # Review schema
├── controllers/
│   ├── auth.controller.js      # Auth & OTP
│   ├── user.controller.js      # User profile
│   ├── shop.controller.js      # Shop management
│   ├── order.controller.js     # Order lifecycle
│   ├── payment.controller.js   # Razorpay + webhooks
│   ├── upload.controller.js    # AWS S3 uploads
│   ├── admin.controller.js     # Admin panel
│   └── notification.controller.js
├── routes/
│   ├── auth.routes.js
│   ├── user.routes.js
│   ├── shop.routes.js
│   ├── order.routes.js
│   ├── payment.routes.js
│   ├── upload.routes.js
│   ├── admin.routes.js
│   └── notification.routes.js
├── middleware/
│   ├── auth.js                 # JWT protect + restrictTo
│   ├── errorHandler.js         # Global error handling
│   └── validate.js             # Joi validation
├── utils/
│   ├── helpers.js              # AppError, asyncHandler
│   ├── qrcode.js               # QR generation
│   ├── pricing.js              # Cost calculation
│   ├── notifications.js        # Notification helpers
│   ├── email.js                # Nodemailer
│   └── pdfUtils.js             # PDF page counting
├── jobs/
│   └── cronJobs.js             # Order expiry + S3 cleanup
├── scripts/
│   └── seedAdmin.js            # Admin user seeder
├── logs/                       # Auto-created log files
├── .env.example
└── package.json
```

---

## ⚙️ Setup & Installation

### 1. Clone & Install

```bash
git clone <repo-url>
cd smart-xerox-backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your actual credentials
```

### 3. Seed Admin User

```bash
node scripts/seedAdmin.js
```

### 4. Run

```bash
# Development
npm run dev

# Production
npm start
```

---

## 🔑 Environment Variables

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `JWT_SECRET` | JWT signing secret (min 32 chars) |
| `JWT_EXPIRES_IN` | Token expiry (e.g. `7d`) |
| `AWS_ACCESS_KEY_ID` | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | AWS secret |
| `AWS_REGION` | S3 bucket region |
| `AWS_S3_BUCKET` | S3 bucket name |
| `RAZORPAY_KEY_ID` | Razorpay live key |
| `RAZORPAY_KEY_SECRET` | Razorpay secret |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook verification secret |
| `FRONTEND_URL` | Allowed CORS origin |

---

## 📡 API Endpoints

### Authentication `/api/auth`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/register` | Register new user/shopkeeper | - |
| POST | `/verify-email` | Verify email with OTP | - |
| POST | `/login` | Login with email+password | - |
| POST | `/send-otp` | Send login OTP to phone | - |
| POST | `/verify-otp` | Verify phone OTP login | - |
| POST | `/refresh-token` | Get new access token | - |
| POST | `/forgot-password` | Send password reset OTP | - |
| POST | `/reset-password` | Reset password with OTP | - |
| POST | `/logout` | Logout | ✅ |
| GET | `/me` | Get current user | ✅ |
| PATCH | `/change-password` | Change password | ✅ |

### Users `/api/users`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/profile` | Get user profile | ✅ |
| PATCH | `/profile` | Update profile | ✅ |
| GET | `/orders` | Order history | ✅ |
| GET | `/stats` | User statistics | ✅ |

### Shops `/api/shops`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/` | List all shops | - |
| GET | `/nearby?lat=&lng=&radius=` | Nearby shops (geospatial) | - |
| GET | `/:id` | Get shop details | - |
| GET | `/:id/reviews` | Shop reviews | - |
| POST | `/` | Create shop | ✅ Shopkeeper |
| PATCH | `/my-shop` | Update shop | ✅ Shopkeeper |
| GET | `/my-shop/dashboard` | Shop dashboard stats | ✅ Shopkeeper |
| PATCH | `/my-shop/toggle-status` | Open/close shop | ✅ Shopkeeper |

### Orders `/api/orders`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/` | Create new order | ✅ User |
| GET | `/my-orders` | User's orders | ✅ User |
| GET | `/:id` | Get single order | ✅ |
| POST | `/:id/extend` | Extend expiry (12h) | ✅ User |
| POST | `/:id/rate` | Rate completed order | ✅ User |
| GET | `/shop/orders` | Shop's orders | ✅ Shopkeeper |
| PATCH | `/:id/accept` | Accept order | ✅ Shopkeeper |
| PATCH | `/:id/reject` | Reject order | ✅ Shopkeeper |
| PATCH | `/:id/status` | Update status (printing/ready) | ✅ Shopkeeper |
| POST | `/verify-pickup` | Verify QR/pickup code | ✅ Shopkeeper |
| GET | `/:orderId/documents/:docId/url` | Get document download URL | ✅ Shopkeeper |

### Payments `/api/payments`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/verify` | Verify payment signature | ✅ |
| POST | `/webhook` | Razorpay webhook | - |
| GET | `/order/:orderId` | Payment details | ✅ |
| POST | `/refund` | Initiate refund | ✅ |

### File Upload `/api/upload`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/single` | Upload one document | ✅ |
| POST | `/multiple` | Upload up to 5 docs | ✅ |
| GET | `/signed-url?key=` | Get S3 presigned URL | ✅ |

### Notifications `/api/notifications`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/` | Get my notifications | ✅ |
| PATCH | `/read` | Mark as read | ✅ |
| PATCH | `/read-all` | Mark all as read | ✅ |
| DELETE | `/:id` | Delete notification | ✅ |

### Admin `/api/admin`

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/dashboard` | Platform overview | ✅ Admin |
| GET | `/analytics` | Order analytics | ✅ Admin |
| GET | `/revenue` | Revenue reports | ✅ Admin |
| GET | `/users` | All users | ✅ Admin |
| PATCH | `/users/:id/toggle-status` | Activate/deactivate user | ✅ Admin |
| GET | `/shops` | All shops | ✅ Admin |
| PATCH | `/shops/:id/verify` | Verify/reject shop | ✅ Admin |
| PATCH | `/shops/:id/margin` | Set platform margin % | ✅ Admin |
| GET | `/orders` | All orders (with filters) | ✅ Admin |
| POST | `/notifications/broadcast` | Broadcast notification | ✅ Admin |

---

## 🔌 Socket.IO Events

### Client → Server

| Event | Data | Description |
|-------|------|-------------|
| `join:shop` | `shopId` | Join shop room (shopkeeper) |

### Server → Client

| Event | Data | Description |
|-------|------|-------------|
| `order:status_update` | `{orderId, status, orderNumber}` | Order status changed |
| `order:new` | `{orderId, orderNumber, ...}` | New order (shop) |
| `order:expiring_soon` | `{orderId, minutesLeft}` | Expiry alert |
| `order:expired` | `{orderId, orderNumber}` | Order expired |
| `order:extended` | `{orderId, newExpiry}` | Order extended |
| `payment:success` | `{orderId, pickupCode, qrCode}` | Payment confirmed |
| `payment:failed` | `{orderId}` | Payment failed |
| `broadcast:notification` | `{title, message}` | Admin broadcast |

---

## 🔐 Security Features

- JWT authentication with refresh tokens
- OTP-based email/phone verification (5-min expiry)
- Razorpay webhook signature verification
- Rate limiting (200 req/15min global, 20 req/15min auth)
- MongoDB injection sanitization
- Helmet.js security headers
- CORS whitelist
- AWS S3 presigned URLs (15-min expiry)
- Input validation via Joi

---

## ⏰ Background Jobs

| Job | Frequency | Description |
|-----|-----------|-------------|
| Expiry Alerts | Every 30 min | Notifies users of orders expiring in 1 hour |
| Order Expiry | Every 15 min | Marks overdue orders as expired |
| S3 Cleanup | Daily 2 AM | Deletes files from old completed/expired orders |

---

## 🏗️ Order Status Flow

```
pending_payment → paid → accepted → printing → ready → picked_up
                       ↘ rejected
                              (any active state) → expired / cancelled
```

---

## 💰 Pricing Formula

```
Document Price = BasePrice (shop) × EffectivePages × Copies
Effective Pages = ceil(pages / 2) for double-sided, else pages
Subtotal = Sum of all document prices
Additional = Binding + Lamination + Urgent charges
Platform Margin = (Subtotal + Additional) × margin%
Total = Subtotal + Additional + Platform Margin
Shop Receivable = Subtotal + Additional (margin stays with platform)
```

---

## 🚀 Deployment (Render)

1. Push code to GitHub
2. Create new Web Service on Render
3. Set environment variables
4. Build command: `npm install`
5. Start command: `npm start`
6. Set Razorpay webhook URL: `https://your-api.render.com/api/payments/webhook`

---

## 📋 Razorpay Webhook Setup

1. Login to Razorpay Dashboard
2. Go to Settings → Webhooks
3. Add webhook URL: `https://your-api.com/api/payments/webhook`
4. Select events: `payment.captured`, `payment.failed`, `refund.processed`
5. Copy webhook secret to `.env` as `RAZORPAY_WEBHOOK_SECRET`
