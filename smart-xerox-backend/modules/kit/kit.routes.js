const express  = require('express');
const multer   = require('multer');
const rateLimit = require('express-rate-limit');
const router   = express.Router();
const ctrl     = require('./kit.controller');
const { protect, restrictTo, optionalAuth } = require('../../middleware/auth');
const { validateObjectId } = require('../../middleware/validate');
const { AppError } = require('../../utils/helpers');

// ─── Multer — memory storage, upload to S3 in controller ─────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (/jpeg|jpg|png|webp/.test(file.mimetype)) cb(null, true);
    else cb(new AppError('Only JPEG/PNG/WEBP images allowed', 400));
  },
});

// Fix #3: Strict rate limiter for order creation — prevents bot flooding
const orderRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                    // 5 orders per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many orders placed. Please try again in 15 minutes.' },
  keyGenerator: (req) => req.ip,
});

// Fix #16: Multer error handler middleware (catches file too large, wrong type, etc.)
function handleMulterError(err, _req, _res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('File too large. Maximum size is 5 MB.', 400));
    }
    return next(new AppError(`Upload error: ${err.message}`, 400));
  }
  next(err);
}

// ─── Public catalog routes ────────────────────────────────────────────────────
router.get('/years',         ctrl.getYears);
router.get('/colleges',      ctrl.getColleges);
router.get('/college-parts', ctrl.getCollegeParts);
router.get('/departments',   ctrl.getDepartments);
router.get('/subjects',      ctrl.getSubjects);
router.get('/notes',         ctrl.getNotes);

// ─── Order creation — optional auth (guests allowed) + rate limited ───────────
router.post('/create-order',
  orderRateLimiter,
  optionalAuth,
  upload.single('paymentScreenshot'),
  handleMulterError,
  ctrl.createOrder
);

// ─── User order tracking ──────────────────────────────────────────────────────
router.get('/my-orders',   optionalAuth, ctrl.getMyOrders);
router.get('/order/:id',   optionalAuth, validateObjectId('id'), ctrl.getOrderStatus);

// ─── Shopkeeper routes ────────────────────────────────────────────────────────
router.get('/shopkeeper/kit-orders',
  protect, restrictTo('shopkeeper', 'admin'),
  ctrl.getKitOrders
);

router.get('/shopkeeper/suspicious-orders',
  protect, restrictTo('shopkeeper', 'admin'),
  ctrl.getSuspiciousOrders
);

router.get('/shopkeeper/fraud-stats',
  protect, restrictTo('shopkeeper', 'admin'),
  ctrl.getFraudStats
);

// Fix #14: Lightweight counts for tab badges
router.get('/shopkeeper/order-counts',
  protect, restrictTo('shopkeeper', 'admin'),
  ctrl.getOrderCounts
);

router.patch('/shopkeeper/kit-order/:id/status',
  protect, restrictTo('shopkeeper', 'admin'),
  validateObjectId('id'),
  ctrl.updateKitOrderStatus
);

router.post('/shopkeeper/verify-otp',
  protect, restrictTo('shopkeeper', 'admin'),
  ctrl.verifyKitOtp
);

// ─── Admin / Batch Management Routes ─────────────────────────────────────────
router.post('/admin/reset-15days',
  protect, restrictTo('shopkeeper', 'admin'),
  ctrl.resetFifteenDayKitOrders
);

router.get('/admin/student-report',
  protect, restrictTo('shopkeeper', 'admin'),
  ctrl.getStudentReport
);

module.exports = router;

