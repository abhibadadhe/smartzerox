const { upload, uploadBufferToS3 } = require('../config/aws');
const { AppError, asyncHandler } = require('../utils/helpers');
const { countFilePages } = require('../utils/pdfUtils');
const PendingUpload = require('../models/PendingUpload');
const Shop = require('../models/Shop');
const Order = require('../models/Order');
const { withS3 } = require('../utils/circuitBreaker');
const logger = require('../config/logger');
const { getSmartPresentationConfig } = require('../utils/presentationDetector');

// How long (minutes) before an unclaimed upload is considered orphaned
const ORPHAN_TTL_MINUTES = parseInt(process.env.ORPHAN_UPLOAD_TTL_MINUTES) || 30;

// ─── Upload Document ──────────────────────────────────────────────────────────
// Flow: multer memoryStorage → count pages from buffer → upload to S3
// This is ~2x faster than multer-s3 because:
//   1. Page counting uses the in-memory buffer (no S3 re-download)
//   2. S3 upload and page counting run in parallel
exports.uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('No file uploaded', 400);

  const file   = req.file;
  const buffer = file.buffer;
  const userId = req.user?.id || 'unknown';

  // ✅ PRODUCTION FIX: Validate file size for bulk uploads
  const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB) || 50;
  const fileSizeMB = file.size / (1024 * 1024);
  
  if (fileSizeMB > MAX_FILE_SIZE_MB) {
    throw new AppError(
      `File too large. Maximum file size is ${MAX_FILE_SIZE_MB}MB. Your file is ${fileSizeMB.toFixed(2)}MB.`,
      400
    );
  }

  // ✅ PRODUCTION FIX: Run page counting and S3 upload in parallel for performance
  const [detectedPages, s3Result] = await Promise.all([
    countFilePages({ ...file, buffer }).catch(err => {
      logger.warn(`Page count failed for ${file.originalname}: ${err.message}`);
      return 0;
    }),
    withS3(() => uploadBufferToS3(buffer, file.originalname, userId, file.mimetype)).catch(err => {
      logger.error(`S3 upload failed for user ${userId}: ${err.message}`);
      throw new AppError(`File upload failed: ${err.message}`, 502);
    }),
  ]);

  // ✅ PRODUCTION FIX: Validate page count for bulk documents
  const MAX_PAGES_PER_DOC = parseInt(process.env.MAX_PAGES_PER_DOC) || 1000;
  if (detectedPages > MAX_PAGES_PER_DOC) {
    // Clean up uploaded S3 file
    try {
      const { deleteObject } = require('../config/aws');
      await deleteObject(s3Result.key);
    } catch (cleanupErr) {
      logger.error(`Failed to cleanup S3 file ${s3Result.key}: ${cleanupErr.message}`);
    }
    
    throw new AppError(
      `Document has too many pages. Maximum ${MAX_PAGES_PER_DOC} pages per document. Your document has ${detectedPages} pages.`,
      400
    );
  }

  // ── FIX #8: Track this upload so orphan cleanup can find it ───────────────────────
  // Non-blocking — a failure here must NOT fail the upload response
  // ✅ FIX #8: Set expiresAt to 24 hours from now (not 30 min)
  // This gives users 24 hours to complete their order before the file is deleted
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);  // 24 hours
  PendingUpload.create({
    s3Key:        s3Result.key,
    s3Url:        s3Result.location,
    userId,
    originalName: file.originalname,
    fileSize:     file.size,
    mimeType:     file.mimetype,
    status:       'pending',
    expiresAt,
  }).catch(err => logger.warn(`PendingUpload record creation failed for ${s3Result.key}: ${err.message}`));

  const docExt = (file.originalname || '').toLowerCase();
  const isWord = docExt.endsWith('.docx') || docExt.endsWith('.doc') ||
    file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.mimetype === 'application/msword';
  const isPPT = docExt.endsWith('.ppt') || docExt.endsWith('.pptx') || docExt.endsWith('.pptm') || 
    docExt.endsWith('.ppsx') || docExt.endsWith('.odp') || docExt.endsWith('.key') ||
    file.mimetype.includes('powerpoint') || file.mimetype.includes('presentationml') || 
    file.mimetype.includes('presentation') || file.mimetype.includes('keynote');
  const isImage = docExt.endsWith('.jpg') || docExt.endsWith('.jpeg') || docExt.endsWith('.png') ||
    (file.mimetype && file.mimetype.startsWith('image/'));
  const manualCountRequired = (isWord || isPPT) && detectedPages === 0;

  // ── NEW: Detect presentation files and provide smart configuration ────────────
  let presentationConfig = null;
  try {
    presentationConfig = getSmartPresentationConfig({
      filename: file.originalname,
      mimeType: file.mimetype,
      pageCount: detectedPages,
    });
  } catch (err) {
    logger.warn(`Presentation detection failed for ${file.originalname}: ${err.message}`);
    presentationConfig = { isPresentationFile: false };
  }

  res.status(200).json({
    success: true,
    message: 'File uploaded successfully',
    data: {
      originalName: file.originalname,
      s3Key:        s3Result.key,
      s3Url:        s3Result.location,
      fileSize:     file.size,
      mimeType:     file.mimetype,
      detectedPages,
      manualCountRequired,
      // ── NEW: Presentation detection and smart config ────────────────────────
      presentationOptions: presentationConfig?.isPresentationFile ? {
        isPresentationFile: true,
        recommendedLayout: presentationConfig.printLayout,
        recommendedSlidesPerPage: presentationConfig.slidesPerPage,
        recommendedOrientation: presentationConfig.orientation,
        recommendedSides: presentationConfig.sides,
        suggestedMessage: presentationConfig.suggestedMessage,
        // Additional PowerPoint-style options
        frameSlides: presentationConfig.frameSlides,
        scaleToFitPaper: presentationConfig.scaleToFitPaper,
        highQuality: presentationConfig.highQuality,
      } : null,
      // ── NEW: Custom Photo / Image Sizing options ────────────────────────────
      imageOptions: isImage ? {
        isImageFile: true,
        printType: 'full_page',
        customWidthCm: 10,
        customHeightCm: 7.5,
        drawCutLines: true,
      } : null,
      disclaimer: detectedPages > 0
        ? 'Page count is auto-detected. Final printed page count may vary due to formatting differences.'
        : manualCountRequired && isPPT
          ? 'Please enter total slides manually for PowerPoint files.'
          : manualCountRequired
            ? 'Please enter total pages manually for DOC/DOCX files.'
            : null,
    },
  });
});

// ─── Upload Multiple Documents ────────────────────────────────────────────────
exports.uploadMultipleDocuments = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) throw new AppError('No files uploaded', 400);

  const userId = req.user?.id || 'unknown';

  // All files upload + page count in parallel
  const uploadedFiles = await Promise.all(
    req.files.map(async (file) => {
      const [detectedPages, s3Result] = await Promise.all([
        countFilePages({ ...file, buffer: file.buffer }).catch(() => 0),
        withS3(() => uploadBufferToS3(file.buffer, file.originalname, userId, file.mimetype)),
      ]);

      // Track each upload for orphan cleanup (non-blocking)
      // ✅ FIX #8: Set expiresAt to 24 hours from now (not 30 min)
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);  // 24 hours
      PendingUpload.create({
        s3Key:        s3Result.key,
        s3Url:        s3Result.location,
        userId,
        originalName: file.originalname,
        fileSize:     file.size,
        mimeType:     file.mimetype,
        status:       'pending',
        expiresAt,
      }).catch(err => logger.warn(`PendingUpload record creation failed for ${s3Result.key}: ${err.message}`));

      const docExt = (file.originalname || '').toLowerCase();
      const isImage = docExt.endsWith('.jpg') || docExt.endsWith('.jpeg') || docExt.endsWith('.png') ||
        (file.mimetype && file.mimetype.startsWith('image/'));

      // ── NEW: Detect presentation files ────────────────────────────────────────
      let presentationConfig = null;
      try {
        presentationConfig = getSmartPresentationConfig({
          filename: file.originalname,
          mimeType: file.mimetype,
          pageCount: detectedPages,
        });
      } catch (err) {
        logger.warn(`Presentation detection failed for ${file.originalname}: ${err.message}`);
        presentationConfig = { isPresentationFile: false };
      }

      return {
        originalName: file.originalname,
        s3Key:        s3Result.key,
        s3Url:        s3Result.location,
        fileSize:     file.size,
        mimeType:     file.mimetype,
        detectedPages,
        // ── NEW: Include presentation options if detected ─────────────────────
        presentationOptions: presentationConfig?.isPresentationFile ? {
          isPresentationFile: true,
          recommendedLayout: presentationConfig.printLayout,
          recommendedSlidesPerPage: presentationConfig.slidesPerPage,
          recommendedOrientation: presentationConfig.orientation,
          recommendedSides: presentationConfig.sides,
          suggestedMessage: presentationConfig.suggestedMessage,
          frameSlides: presentationConfig.frameSlides,
          scaleToFitPaper: presentationConfig.scaleToFitPaper,
          highQuality: presentationConfig.highQuality,
        } : null,
        // ── NEW: Include image options if detected ────────────────────────────
        imageOptions: isImage ? {
          isImageFile: true,
          printType: 'full_page',
          customWidthCm: 10,
          customHeightCm: 7.5,
          drawCutLines: true,
        } : null,
      };
    })
  );

  res.status(200).json({
    success: true,
    message: `${uploadedFiles.length} file(s) uploaded successfully`,
    data: {
      files: uploadedFiles,
      disclaimer: 'Page counts are auto-detected and may vary slightly from actual printed pages.',
    },
  });
});

// ─── Get Presigned URL for Download ──────────────────────────────────────────
exports.getDownloadUrl = asyncHandler(async (req, res) => {
  const { key } = req.query;
  if (!key) throw new AppError('S3 key is required', 400);

  const PendingUpload = require('../models/PendingUpload');
  const pending = await PendingUpload.findOne({ s3Key: key });
  if (pending) {
    if (pending.userId.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Access denied', 403);
    }
  } else {
    const shopIds = req.user.role === 'shopkeeper'
      ? await Shop.find({ owner: req.user.id }).distinct('_id')
      : [];
    const ownedOrder = await Order.findOne({
      'documents.s3Key': key,
      $or: [
        { user: req.user.id },
        ...(shopIds.length ? [{ shop: { $in: shopIds } }] : []),
      ],
    });
    if (!ownedOrder && req.user.role !== 'admin') {
      throw new AppError('Access denied', 403);
    }
  }

  const { getPresignedUrl } = require('../config/aws');
  const url = await getPresignedUrl(key, 900);
  res.status(200).json({ success: true, data: { url, expiresIn: 900 } });
});

// Multer middleware exports
exports.uploadSingle   = upload.single('document');
exports.uploadMultiple = upload.array('documents', 5);
