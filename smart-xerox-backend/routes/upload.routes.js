const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const uploadController = require('../controllers/upload.controller');
const { protect } = require('../middleware/auth');

router.use(protect);

// ✅ FIX #1: Rate limit for S3 download URL generation to prevent key enumeration
const downloadUrlLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute per IP
  message: 'Too many download requests. Please try again in a minute.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/single',
  uploadController.uploadSingle,
  uploadController.uploadDocument
);

router.post(
  '/multiple',
  uploadController.uploadMultiple,
  uploadController.uploadMultipleDocuments
);

router.get('/signed-url', downloadUrlLimiter, uploadController.getDownloadUrl);

module.exports = router;
