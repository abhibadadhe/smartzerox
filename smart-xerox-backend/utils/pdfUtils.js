const path = require('path');
const pdfParse = require('pdf-parse');
const logger = require('../config/logger');

/**
 * Count pages directly from an in-memory buffer — no S3 round-trip needed.
 * multer-s3 does NOT keep file.buffer, so we intercept before upload via
 * a custom multer storage or read from the stream. For now we accept a
 * raw Buffer passed explicitly from the upload controller.
 */
const countPDFPagesFromBuffer = async (buffer) => {
  try {
    const data = await pdfParse(buffer, { max: 0 }); // max:0 = parse structure only, skip text extraction
    return data.numpages;
  } catch (err) {
    logger.warn(`PDF page count failed: ${err.message}`);
    return 0;
  }
};

const countFilePages = async (file) => {
  let mime = (file.mimetype || '').toLowerCase();
  const ext = path.extname(file.originalname || '').toLowerCase();

  // Normalise mime from extension when browser sends generic octet-stream
  if (!mime || mime === 'application/octet-stream') {
    if (ext === '.pdf')                      mime = 'application/pdf';
    else if (ext === '.png')                 mime = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
    else if (ext === '.docx')                mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (ext === '.doc')                 mime = 'application/msword';
    // ── PowerPoint normalization ──
    else if (ext === '.pptx')                mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    else if (ext === '.ppt')                 mime = 'application/vnd.ms-powerpoint';
    else if (ext === '.pptm')                mime = 'application/vnd.ms-powerpoint.presentation.macroEnabled.12';
    else if (ext === '.ppsx')                mime = 'application/vnd.openxmlformats-officedocument.presentationml.slideshow';
    else if (ext === '.odp')                 mime = 'application/vnd.oasis.opendocument.presentation';
    else if (ext === '.key')                 mime = 'application/x-iwork-keynote-sffkey';
  }

  // Images are always 1 page — covers image/jpeg, image/jpg, image/png, image/*
  if (mime.startsWith('image/') || ['.jpg', '.jpeg', '.png'].includes(ext)) return 1;

  // PDF
  if (mime === 'application/pdf' || ext === '.pdf') {
    if (file.buffer) return countPDFPagesFromBuffer(file.buffer);
    logger.warn(`No buffer available for ${file.originalname} — page count skipped`);
    return 0;
  }

  // ✅ FIX #15: DOC/DOCX — cannot count without conversion
  // Return 0 to signal frontend that manual entry is required
  // Frontend will show "Please enter total pages manually" message
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mime === 'application/msword' ||
      ext === '.docx' || ext === '.doc') {
    logger.info(`DOC/DOCX file detected: ${file.originalname} — manual page count required`);
    return 0;  // Signal to frontend: manual entry needed
  }

  // ✅ NEW: PPT/PPTX — cannot count slides without conversion
  // Return 0 to signal frontend that manual entry is required
  // Frontend will show "Please enter total slides manually" message
  const pptMimes = [
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
    'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
    'application/vnd.oasis.opendocument.presentation',
    'application/x-iwork-keynote-sffkey',
  ];
  const pptExts = ['.ppt', '.pptx', '.pptm', '.ppsx', '.odp', '.key'];
  
  if (pptMimes.includes(mime) || pptExts.includes(ext)) {
    logger.info(`Presentation file detected: ${file.originalname} — manual slide count required`);
    return 0;  // Signal to frontend: manual entry needed
  }

  // Unknown format
  logger.warn(`Unknown file format: ${file.originalname} (mime: ${mime}, ext: ${ext})`);
  return 0;
};

/**
 * Parse page range string like "1-5,7,10-12" into array of page numbers
 */
const parsePageRange = (pageRange, totalPages) => {
  if (!pageRange || pageRange === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set();
  const parts = pageRange.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(Number);
      for (let i = start; i <= Math.min(end, totalPages); i++) pages.add(i);
    } else {
      const num = parseInt(trimmed);
      if (num >= 1 && num <= totalPages) pages.add(num);
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
};

/**
 * Calculate actual pages to print based on page range
 */
const getPrintablePageCount = (detectedPages, pageRange) => {
  if (!pageRange || pageRange === 'all') return detectedPages;
  const pages = parsePageRange(pageRange, detectedPages);
  return pages.length;
};

module.exports = { countFilePages, parsePageRange, getPrintablePageCount };
