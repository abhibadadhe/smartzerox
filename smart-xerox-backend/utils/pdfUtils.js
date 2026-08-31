const path = require('path');
const zlib = require('zlib');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const logger = require('../config/logger');

/**
 * Multi-Engine PDF Page Counter
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

/**
 * Auto-detect slide count from PPTX / PPT files
 */
const countPresentationSlides = (buffer) => {
  if (!buffer || buffer.length === 0) return 0;
  try {
    const str = buffer.toString('latin1');

    // Method 1: Check docProps/app.xml <Slides>N</Slides>
    const slidesMatch = str.match(/<Slides>(\d+)<\/Slides>/i);
    if (slidesMatch && slidesMatch[1]) {
      const n = parseInt(slidesMatch[1], 10);
      if (n > 0 && n < 5000) return n;
    }

    // Method 2: Count ppt/slides/slideN.xml in the zip directory
    const slideEntries = str.match(/ppt\/slides\/slide\d+\.xml/gi);
    if (slideEntries && slideEntries.length > 0) {
      const unique = new Set(slideEntries.map(s => s.toLowerCase()));
      return unique.size;
    }

    // Method 3: Legacy .ppt slide header scan
    const legacyMatches = str.match(/slideShowSlideInfoAtom/gi);
    if (legacyMatches && legacyMatches.length > 0) {
      return legacyMatches.length;
    }
  } catch (e) {}

  return 0;
};

/**
 * Robust Word (.docx/.doc) Page Counter
 */
const countWordPages = (buffer) => {
  if (!buffer || buffer.length === 0) return 1;
  const raw = buffer.toString('latin1');

  // 1. Direct Regex for <Pages>N</Pages>
  const pagesMatch = raw.match(/<Pages>(\d+)<\/Pages>/i);
  if (pagesMatch && pagesMatch[1]) {
    const n = parseInt(pagesMatch[1], 10);
    if (n > 0 && n < 5000) return n;
  }

  // 2. Count page breaks in raw stream
  const pageBreaks = raw.match(/<w:lastRenderedPageBreak\/>|<w:br\s+w:type="page"\/>/gi);
  if (pageBreaks && pageBreaks.length > 0) {
    return pageBreaks.length + 1;
  }

  // 3. Zip stream decompression for docProps/app.xml & word/document.xml
  try {
    let offset = 0;
    while (offset < buffer.length - 30) {
      if (buffer[offset] === 0x50 && buffer[offset+1] === 0x4b && buffer[offset+2] === 0x03 && buffer[offset+3] === 0x04) {
        const compMethod = buffer.readUInt16LE(offset + 8);
        const compSize = buffer.readUInt32LE(offset + 18);
        const nameLen = buffer.readUInt16LE(offset + 26);
        const extraLen = buffer.readUInt16LE(offset + 28);
        const fileName = buffer.toString('utf8', offset + 30, offset + 30 + nameLen);
        const dataOffset = offset + 30 + nameLen + extraLen;

        if (fileName === 'docProps/app.xml' && compSize > 0 && dataOffset + compSize <= buffer.length) {
          const compData = buffer.slice(dataOffset, dataOffset + compSize);
          let xmlStr = compMethod === 8 ? zlib.inflateRawSync(compData).toString('utf8') : compData.toString('utf8');
          const m = xmlStr.match(/<Pages>(\d+)<\/Pages>/i);
          if (m && m[1]) {
            const p = parseInt(m[1], 10);
            if (p > 0) return p;
          }
          const wm = xmlStr.match(/<Words>(\d+)<\/Words>/i);
          if (wm && wm[1]) {
            const words = parseInt(wm[1], 10);
            if (words > 0) return Math.max(1, Math.ceil(words / 350));
          }
        }

        if (fileName === 'word/document.xml' && compSize > 0 && dataOffset + compSize <= buffer.length) {
          try {
            const compData = buffer.slice(dataOffset, dataOffset + compSize);
            let xmlStr = compMethod === 8 ? zlib.inflateRawSync(compData).toString('utf8') : compData.toString('utf8');
            const breaks = xmlStr.match(/<w:lastRenderedPageBreak\/>|<w:br\s+w:type="page"\/>/gi);
            if (breaks && breaks.length > 0) {
              return breaks.length + 1;
            }
          } catch (e) {}
        }

        offset = dataOffset + compSize;
      } else {
        offset++;
      }
    }
  } catch (err) {}

  // 4. Word count estimation fallback
  const wordsMatch = raw.match(/<Words>(\d+)<\/Words>/i);
  if (wordsMatch && wordsMatch[1]) {
    const words = parseInt(wordsMatch[1], 10);
    if (words > 0) return Math.max(1, Math.ceil(words / 350));
  }

  return 1;
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

  // 1. Images are always 1 page
  if (mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'].includes(ext)) {
    return 1;
  }

  // 2. PDF Documents
  if (mime === 'application/pdf' || ext === '.pdf') {
    if (file.buffer) return countPDFPagesFromBuffer(file.buffer);
    logger.warn(`No buffer available for ${file.originalname} — page count skipped`);
    return 0;
  }

  // 3. PPT / PPTX Presentations
  if (['.pptx', '.ppt', '.pptm', '.ppsx', '.odp'].includes(ext)) {
    if (file.buffer) {
      const slideCount = countPresentationSlides(file.buffer);
      if (slideCount > 0) return slideCount;
    }
    return 0;
  }

  // 4. Word DOCX / DOC Documents
  if (['.docx', '.doc'].includes(ext)) {
    if (file.buffer) {
      const wordPageCount = countWordPages(file.buffer);
      if (wordPageCount > 0) return wordPageCount;
    }
    return 1;
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

module.exports = { countFilePages, parsePageRange, getPrintablePageCount, countPDFPagesFromBuffer, countPresentationSlides, countWordPages };
