const path = require('path');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const logger = require('../config/logger');

/**
 * Multi-Engine PDF Page Counter:
 * 1. pdf-lib (Fastest, handles modern object streams and encrypted xrefs)
 * 2. pdf-parse (Standard fallback)
 * 3. Binary regex scanner (/Type /Page and /Count N)
 */
const countPDFPagesFromBuffer = async (buffer) => {
  if (!buffer || buffer.length === 0) return 0;

  // Engine 1: pdf-lib
  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const count = pdfDoc.getPageCount();
    if (count > 0) return count;
  } catch (err) {
    logger.warn(`pdf-lib count fallback: ${err.message}`);
  }

  // Engine 2: pdf-parse
  try {
    const data = await pdfParse(buffer, { max: 0 });
    if (data && data.numpages > 0) return data.numpages;
  } catch (err) {
    logger.warn(`pdf-parse count fallback: ${err.message}`);
  }

  // Engine 3: Binary Stream Scanner
  try {
    const str = buffer.toString('latin1');
    const matches = str.match(/\/Type\s*\/Page[^s]/g);
    if (matches && matches.length > 0) return matches.length;

    const countMatch = str.match(/\/Count\s+(\d+)/);
    if (countMatch && countMatch[1]) {
      const parsed = parseInt(countMatch[1], 10);
      if (parsed > 0 && parsed < 10000) return parsed;
    }
  } catch (err) {
    logger.warn(`Binary scanner count fallback: ${err.message}`);
  }

  return 0;
};

const countFilePages = async (file) => {
  let mime = (file.mimetype || '').toLowerCase();
  const ext = path.extname(file.originalname || '').toLowerCase();

  // Normalize mime from extension
  if (!mime || mime === 'application/octet-stream') {
    if (ext === '.pdf')                      mime = 'application/pdf';
    else if (ext === '.png')                 mime = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
    else if (ext === '.docx')                mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (ext === '.doc')                 mime = 'application/msword';
    else if (ext === '.pptx')                mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    else if (ext === '.ppt')                 mime = 'application/vnd.ms-powerpoint';
  }

  // Images are always 1 page
  if (mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'].includes(ext)) {
    return 1;
  }

  // PDF
  if (mime === 'application/pdf' || ext === '.pdf') {
    if (file.buffer) return countPDFPagesFromBuffer(file.buffer);
    logger.warn(`No buffer available for ${file.originalname} — page count skipped`);
    return 0;
  }

  // DOC/DOCX / PPT/PPTX
  if (['.docx', '.doc', '.pptx', '.ppt', '.pptm', '.ppsx', '.odp'].includes(ext)) {
    return 0; // Manual entry / auto-converted on print
  }

  return 0;
};

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

const getPrintablePageCount = (detectedPages, pageRange) => {
  if (!pageRange || pageRange === 'all') return detectedPages;
  const pages = parsePageRange(pageRange, detectedPages);
  return pages.length;
};

module.exports = { countFilePages, parsePageRange, getPrintablePageCount, countPDFPagesFromBuffer };
