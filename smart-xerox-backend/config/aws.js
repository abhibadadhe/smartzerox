const { S3Client, GetObjectCommand, DeleteObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ✅ PRODUCTION FIX: Enhanced S3 client configuration for bulk uploads
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  // ✅ PRODUCTION FIX: Increased timeouts for large file uploads (bulk orders)
  requestHandler: {
    requestTimeout:    60000,  // 60s (was 30s) - allows large files up to 100MB
    connectionTimeout: 10000,  // 10s (was 5s) - more reliable for high load
  },
  // ✅ PRODUCTION FIX: Adaptive retry with exponential backoff
  maxAttempts: 3,
  retryMode: 'adaptive',  // AWS SDK v3 adaptive retry strategy
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET;

// ─── Allowed MIME types (whitelist — not blacklist) ───────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/x-msword',                                                          // Windows alternate
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-word',                                                       // another alternate
  // ── PowerPoint MIME types ──────────────────────────────────────────────────
  'application/vnd.ms-powerpoint',                                                 // .ppt
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',    // .pptx
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',       // .ppsx
  'application/vnd.ms-powerpoint.presentation.macroEnabled.12',                   // .pptm
  'application/vnd.oasis.opendocument.presentation',                              // .odp
  'application/x-iwork-keynote-sffkey',                                           // .key
  // ───────────────────────────────────────────────────────────────────────────
  'application/octet-stream',                                                      // generic binary — validated by extension
  'image/jpeg',
  'image/jpg',
  'image/png',
]);

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.pptm', '.odp', '.key', '.jpg', '.jpeg', '.png']);

// ─── Sanitize filename — strip path traversal and special chars ───────────────
const sanitizeFilename = (originalName) => {
  const base = path.basename(originalName);
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 200);
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB
    files: 5,
    fields: 10,
    fieldSize: 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();

    // Extension must be in whitelist — primary gate
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error(`File type not supported. Allowed: PDF, DOC, DOCX, PPT, PPTX, JPG, PNG`), false);
    }

    // MIME must be in whitelist OR be octet-stream (generic binary from some OS/browsers)
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      return cb(new Error(`File type not supported. Allowed: PDF, DOC, DOCX, PPT, PPTX, JPG, PNG`), false);
    }

    // For non-octet-stream MIMEs, do a loose extension compatibility check
    // (avoids rejecting valid files due to browser MIME variation)
    if (mime !== 'application/octet-stream') {
      const imageExts = ['.jpg', '.jpeg', '.png'];
      const docExts = ['.doc', '.docx'];
      const pptExts = ['.ppt', '.pptx', '.pptm', '.odp', '.key'];
      const isImageMime = mime.startsWith('image/');
      const isDocMime = mime.includes('msword') || mime.includes('wordprocessingml') || mime.includes('vnd.ms-word');
      const isPptMime = mime.includes('powerpoint') || mime.includes('presentationml') || mime.includes('presentation') || mime.includes('keynote');
      const isPdfMime = mime === 'application/pdf';

      if (isPdfMime && ext !== '.pdf') {
        return cb(new Error('PDF MIME type requires .pdf extension'), false);
      }
      if (isImageMime && !imageExts.includes(ext)) {
        return cb(new Error('Image MIME type requires .jpg, .jpeg, or .png extension'), false);
      }
      if (isDocMime && !docExts.includes(ext)) {
        return cb(new Error('Word MIME type requires .doc or .docx extension'), false);
      }
      if (isPptMime && !pptExts.includes(ext)) {
        return cb(new Error('PowerPoint MIME type requires .ppt, .pptx, .pptm, .odp, or .key extension'), false);
      }
    }

    cb(null, true);
  },
});

// Upload a buffer to S3 and return { key, location }
const uploadBufferToS3 = async (buffer, originalName, userId, contentType) => {
  const ext      = path.extname(originalName).toLowerCase();
  const key      = `documents/${userId}/${uuidv4()}${ext}`;
  const safeName = sanitizeFilename(originalName);

  const command = new PutObjectCommand({
    Bucket:             BUCKET_NAME,
    Key:                key,
    Body:               buffer,
    ContentType:        contentType || 'application/octet-stream',
    ContentDisposition: `attachment; filename="${safeName}"`,
    Metadata: {
      userId:       userId || 'unknown',
      originalName: safeName,
      uploadedAt:   new Date().toISOString(),
    },
  });

  try {
    await s3Client.send(command);
  } catch (err) {
    // Wrap S3 errors with a clear message — DNS/credential errors are common in dev
    const msg = err.code === 'ENOTFOUND'
      ? `S3 upload failed: Cannot reach AWS S3. Check AWS_S3_BUCKET and AWS credentials in .env`
      : `S3 upload failed: ${err.message}`;
    throw new Error(msg);
  }

  // Virtual-hosted style URL (correct for all regions)
  const region   = process.env.AWS_REGION || 'ap-south-1';
  const location = `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`;
  return { key, location };
};

// Generate a pre-signed GET URL (expires in 1 hour by default)
const getPresignedUrl = async (key, expiresIn = 3600) => {
  const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn });
};

// Delete a file from S3
const deleteFile = async (key) => {
  const command = new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key });
  return s3Client.send(command);
};

// Upload a buffer to S3 directly
const uploadBuffer = async (buffer, key, contentType = 'application/pdf') => {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });
  return s3Client.send(command);
};

// Download a file from S3 as buffer
const getObject = async (key) => {
  const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
  try {
    const response = await s3Client.send(command);
    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    // ✅ PRODUCTION FIX: Enhanced error messages for common S3 errors
    if (err.name === 'NoSuchKey') {
      throw new Error(`File not found in S3: ${key}. The file may have been deleted or moved.`);
    }
    if (err.name === 'AccessDenied') {
      throw new Error(`Access denied to S3 file: ${key}. Check AWS credentials and bucket permissions.`);
    }
    throw new Error(`Failed to download from S3: ${err.message}`);
  }
};

module.exports = { s3Client, upload, getPresignedUrl, deleteFile, uploadBuffer, uploadBufferToS3, getObject, sanitizeFilename, BUCKET_NAME };
