const path = require('path');
const zlib = require('zlib');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const logger = require('../config/logger');

/**
 * Exact Word (.docx / .doc) Page Extractor
 * Decompresses docProps/app.xml directly from ZIP stream to read canonical <Pages>N</Pages>
 */
const countWordPages = (buffer) => {
  if (!buffer || buffer.length < 30) return 1;

  // 1. Check Central Directory at the end of the ZIP archive (most reliable)
  try {
    const eocdIndex = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocdIndex !== -1 && eocdIndex >= 22) {
      const cdOffset = buffer.readUInt32LE(eocdIndex + 16);
      let cur = cdOffset;
      while (cur < eocdIndex && cur < buffer.length - 46) {
        if (buffer[cur] === 0x50 && buffer[cur+1] === 0x4b && buffer[cur+2] === 0x01 && buffer[cur+3] === 0x02) {
          const compMethod = buffer.readUInt16LE(cur + 10);
          const compSize = buffer.readUInt32LE(cur + 20);
          const nameLen = buffer.readUInt16LE(cur + 28);
          const extraLen = buffer.readUInt16LE(cur + 30);
          const commentLen = buffer.readUInt16LE(cur + 32);
          const localHeaderOffset = buffer.readUInt32LE(cur + 42);
          const fileName = buffer.toString('utf8', cur + 46, cur + 46 + nameLen);

          if (fileName === 'docProps/app.xml') {
            const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
            const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
            const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
            const compData = buffer.slice(dataOffset, dataOffset + compSize);
            let xmlStr = compMethod === 8 ? zlib.inflateRawSync(compData).toString('utf8') : compData.toString('utf8');
            const m = xmlStr.match(/<Pages>(\d+)<\/Pages>/i);
            if (m && m[1]) {
              const p = parseInt(m[1], 10);
              if (p > 0) return p;
            }
          }
          cur += 46 + nameLen + extraLen + commentLen;
        } else {
          cur++;
        }
      }
    }
  } catch (cdErr) {}

  // 2. Scan Local File Headers in ZIP stream
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
        }
        offset = dataOffset + compSize;
      } else {
        offset++;
      }
    }
  } catch (err) {}

  // 3. Fallback: Search uncompressed string directly
  const raw = buffer.toString('latin1');
  const m = raw.match(/<Pages>(\d+)<\/Pages>/i);
  if (m && m[1]) {
    const p = parseInt(m[1], 10);
    if (p > 0) return p;
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
