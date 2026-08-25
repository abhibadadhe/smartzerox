/**
 * OTP Routes - Admin & Monitoring
 * 
 * All routes require admin authentication
 */

const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const otpController = require('../controllers/otp.controller');

// All OTP routes require authentication and admin role
router.use(protect);
router.use(restrictTo('admin'));

/**
 * GET /api/otp/stats/:shopId
 * Get OTP statistics for a shop
 */
router.get('/stats/:shopId', otpController.getOTPStats);

/**
 * GET /api/otp/active/:shopId
 * Get all active OTPs for a shop
 */
router.get('/active/:shopId', otpController.getActiveOTPs);

/**
 * POST /api/otp/reset/:shopId
 * Reset OTP counter for a shop
 * Body: { resetValue: 0 }
 */
router.post('/reset/:shopId', otpController.resetOTPCounter);

/**
 * GET /api/otp/health
 * System health check - OTP subsystem
 */
router.get('/health', otpController.getOTPHealth);

/**
 * GET /api/otp/metrics
 * Get OTP generation metrics
 */
router.get('/metrics', otpController.getOTPMetrics);

/**
 * POST /api/otp/validate
 * Validate OTP (for testing/debugging)
 * Body: { orderId, otp }
 */
router.post('/validate', otpController.validateOTP);

module.exports = router;
