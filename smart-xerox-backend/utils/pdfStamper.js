const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');
const logger = require('../config/logger');

/**
 * Draw the OTP stamp on a single pdf-lib page object.
 * Vertical orientation (rotated 90°), bottom-left corner, properly positioned within page bounds.
 */
async function _drawStamp(pdfDoc, page, otp) {
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = 10;
  // Use a 20-point margin (~7mm) to ensure it clears printer hardware unprintable margins
  const margin = 20;
  const stampText = `${otp}`;  // Only the number, no "OTP:" prefix

  // For 90 degree rotation (CCW):
  // The baseline starts at (x,y) and goes UP.
  // Characters extend LEFT from the baseline (towards x=0).
  // To keep the left edge of characters at `margin`, x must be `margin + fontSize`.
  const x = margin + fontSize;
  const y = margin;

  page.drawText(stampText, {
    x: x,
    y: y,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
    opacity: 0.85,
    rotate: degrees(90),
  });
}

/**
 * Stamp OTP on PDF pages according to the shop's otpPlacement setting.
 *
 * Placement options:
 *   'first_page'  — stamp only the first page (default / legacy)
 *   'last_page'   — stamp only the last page
 *   'all_pages'   — stamp every page
 *   'extra_page'  — append a blank A4 page at the end with the OTP printed on it
 *
 * @param {Buffer} pdfBuffer  - Original PDF buffer
 * @param {string} otp        - OTP / queue number to stamp (e.g. "42")
 * @param {string} placement  - One of the four values above (defaults to 'first_page')
 * @returns {Promise<Buffer>} - Modified PDF buffer (original returned on failure)
 */
const stampOTPOnPDF = async (pdfBuffer, otp, placement = 'all_pages') => {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();

    if (pages.length === 0) {
      logger.warn('PDF has no pages — OTP stamp skipped');
      return pdfBuffer;
    }

    switch (placement) {
      case 'all_pages':
        for (const page of pages) {
          await _drawStamp(pdfDoc, page, otp);
        }
        break;

      case 'last_page':
        await _drawStamp(pdfDoc, pages[pages.length - 1], otp);
        break;

      case 'extra_page': {
        const A4W = 595.28, A4H = 841.89;
        const extraPage = pdfDoc.addPage([A4W, A4H]);
        const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const text = `${otp}`;  // Only the number
        const fontSize = 48;
        const textW = font.widthOfTextAtSize(text, fontSize);
        extraPage.drawText(text, {
          x: (A4W - textW) / 2,
          y: A4H / 2 - fontSize / 2,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
        break;
      }

      case 'first_page':
      default:
        await _drawStamp(pdfDoc, pages[0], otp);
        break;
    }

    const modified = await pdfDoc.save();
    return Buffer.from(modified);
  } catch (err) {
    logger.error(`OTP stamp failed: ${err.message}`);
    return pdfBuffer; // fall back to original
  }
};

module.exports = { stampOTPOnPDF };
