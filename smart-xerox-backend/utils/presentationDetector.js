/**
 * Presentation File Detector & Smart Configuration
 * ─────────────────────────────────────────────────────────────────────────────
 * Automatically detects PowerPoint, Google Slides, and other presentation files
 * and applies smart printing defaults for optimal handout printing.
 *
 * Features:
 * - Detects .ppt, .pptx, .odp, .key files
 * - Detects PDF files exported from presentations (by analyzing content)
 * - Auto-configures landscape orientation for handouts
 * - Suggests optimal slides-per-page layout
 * - Configures duplex printing for handouts
 */

'use strict';

const logger = require('../config/logger');

// ─── File Extension Detection ─────────────────────────────────────────────────

const PRESENTATION_EXTENSIONS = [
  '.ppt',   // Microsoft PowerPoint 97-2003
  '.pptx',  // Microsoft PowerPoint 2007+
  '.pptm',  // PowerPoint Macro-Enabled
  '.odp',   // OpenDocument Presentation
  '.key',   // Apple Keynote
  '.pdf',   // PDF (may be exported from PPT)
];

const PRESENTATION_MIME_TYPES = [
  'application/vnd.ms-powerpoint',                                                      // .ppt
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',         // .pptx
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',            // .ppsx
  'application/vnd.ms-powerpoint.presentation.macroEnabled.12',                        // .pptm
  'application/vnd.oasis.opendocument.presentation',                                   // .odp
  'application/x-iwork-keynote-sffkey',                                                // .key
  'application/pdf',                                                                   // .pdf (may be from PPT)
];

/**
 * Check if a file is a presentation based on extension or MIME type
 */
function isPresentationFile(filename, mimeType) {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  
  const isPresExtension = PRESENTATION_EXTENSIONS.includes(ext);
  const isPresMimeType = mimeType && PRESENTATION_MIME_TYPES.includes(mimeType);
  
  return isPresExtension || isPresMimeType;
}

/**
 * Detect if a PDF was likely exported from a presentation
 * (This is a heuristic based on page dimensions and aspect ratio)
 * 
 * Standard presentation aspect ratios:
 * - 16:9 (widescreen) - most common
 * - 4:3 (standard)
 * - A4 portrait is 1:1.414 (not presentation)
 * 
 * @param {number} pageWidth - PDF page width in points
 * @param {number} pageHeight - PDF page height in points
 * @returns {boolean}
 */
function isPresentationPDF(pageWidth, pageHeight) {
  if (!pageWidth || !pageHeight) return false;
  
  const aspectRatio = pageWidth / pageHeight;
  
  // Common presentation aspect ratios (with tolerance)
  const WIDESCREEN_16_9 = 16 / 9;  // 1.778
  const STANDARD_4_3 = 4 / 3;      // 1.333
  const TOLERANCE = 0.1;
  
  const isWidescreen = Math.abs(aspectRatio - WIDESCREEN_16_9) < TOLERANCE;
  const isStandard = Math.abs(aspectRatio - STANDARD_4_3) < TOLERANCE;
  
  return isWidescreen || isStandard;
}

// ─── Smart Configuration ──────────────────────────────────────────────────────

/**
 * Get smart printing defaults for presentation files
 * Matches PowerPoint's exact print layout options
 * 
 * @param {Object} options
 * @param {string} options.filename - Original filename
 * @param {string} options.mimeType - File MIME type
 * @param {number} options.pageCount - Number of pages/slides
 * @param {number} options.pageWidth - PDF page width (optional)
 * @param {number} options.pageHeight - PDF page height (optional)
 * @returns {Object} Smart configuration
 */
function getSmartPresentationConfig(options) {
  const { filename, mimeType, pageCount, pageWidth, pageHeight } = options;
  
  const isPresentation = isPresentationFile(filename, mimeType);
  const isPDF = filename.toLowerCase().endsWith('.pdf');
  const isPresentationPDFFile = isPDF && isPresentationPDF(pageWidth, pageHeight);
  
  const isPresentationDocument = isPresentation || isPresentationPDFFile;
  
  if (!isPresentationDocument) {
    return {
      isPresentationFile: false,
      printLayout: 'full_page_slides',
      slidesPerPage: 1,
      includeNotes: false,
      frameSlides: false,
      autoLandscape: false,
      orientation: 'auto',
      // ✅ FIX EDGE CASE #2: Don't set sides default - let frontend enforce explicit selection
      // sides: 'single',  // Removed to force explicit user choice
      pagesPerSheet: 1,
      suggestedMessage: null,
    };
  }
  
  // ── Smart defaults for presentations (matching PowerPoint) ────────────────
  
  let recommendedLayout = 'handouts_4_horizontal';
  let recommendedSlidesPerPage = 4;
  let recommendedOrientation = 'landscape';
  // ✅ FIX EDGE CASE #2: Provide recommendation but don't auto-apply
  // Frontend should show this as a SUGGESTION, not auto-select
  let recommendedSides = 'double';  // Recommended, but not applied
  let suggestedMessage = '';
  
  // Adjust based on slide count
  if (pageCount <= 10) {
    // Few slides: 2 per page for better readability
    recommendedLayout = 'handouts_2_horizontal';
    recommendedSlidesPerPage = 2;
    suggestedMessage = 'Few slides detected - using 2 slides per page for better readability';
  } else if (pageCount <= 30) {
    // Medium: 4 per page (most common)
    recommendedLayout = 'handouts_4_horizontal';
    recommendedSlidesPerPage = 4;
    suggestedMessage = 'Using 4 slides per page - optimal for most presentations';
  } else if (pageCount <= 60) {
    // Many slides: 6 per page to save paper
    recommendedLayout = 'handouts_6_horizontal';
    recommendedSlidesPerPage = 6;
    suggestedMessage = 'Many slides detected - using 6 slides per page to save paper';
  } else {
    // Very many slides: 9 per page
    recommendedLayout = 'handouts_9_horizontal';
    recommendedSlidesPerPage = 9;
    suggestedMessage = 'Large presentation - using 9 slides per page for compact printing';
  }
  
  return {
    isPresentationFile: true,
    printLayout: recommendedLayout,
    slidesPerPage: recommendedSlidesPerPage,
    includeNotes: false,
    frameSlides: true,
    scaleToFitPaper: true,
    highQuality: true,
    printHiddenSlides: false,
    collate: true,
    orientation: recommendedOrientation, // 'landscape' or 'portrait'
    autoLandscape: true, // Deprecated - kept for backward compatibility
    sides: recommendedSides,
    pagesPerSheet: 1, // This is for PDF n-up, not PPT slides per page
    suggestedMessage,
    detectionMethod: isPresentationPDFFile ? 'pdf_aspect_ratio' : 'file_extension',
  };
}

/**
 * Apply smart presentation configuration to a document object
 * Modifies the document in place
 * 
 * @param {Object} document - Document object from Order model
 * @returns {Object} Updated document with presentation options
 */
function applySmartPresentationConfig(document) {
  const config = getSmartPresentationConfig({
    filename: document.originalName,
    mimeType: document.mimeType,
    pageCount: document.detectedPages,
    pageWidth: document.pdfMetadata?.pageWidth,
    pageHeight: document.pdfMetadata?.pageHeight,
  });
  
  if (!config.isPresentationFile) {
    return document;
  }
  
  // Apply presentation options
  document.presentationOptions = {
    isPresentationFile: config.isPresentationFile,
    handoutLayout: config.handoutLayout,
    slidesPerPage: config.slidesPerPage,
    includeNotes: config.includeNotes,
    frameSlides: config.frameSlides,
    autoLandscape: config.autoLandscape,
  };
  
  // Apply printing options
  if (config.autoLandscape) {
    document.printingOptions = document.printingOptions || {};
    document.printingOptions.orientation = config.orientation;
  }
  
  // ✅ FIX EDGE CASE #2: Don't auto-apply sides to ranges
  // Frontend must show recommendation but require explicit user selection
  // if (document.printingRanges && document.printingRanges.length > 0) {
  //   document.printingRanges.forEach(range => {
  //     if (config.sides) {
  //       range.sides = config.sides;  // REMOVED: No auto-apply
  //     }
  //   });
  // }
  
  logger.info(
    `📊 Presentation detected: ${document.originalName} ` +
    `(${config.slidesPerPage} slides/page, ${config.orientation}, ${config.sides})`
  );
  
  return document;
}

/**
 * Get user-friendly description of print layout (matching PowerPoint)
 */
function getPrintLayoutDescription(layout) {
  const descriptions = {
    'full_page_slides': 'Full Page Slides (1 slide per page)',
    'notes_pages': 'Notes Pages (slide with speaker notes)',
    'outline': 'Outline (text only)',
    'handouts_1': 'Handouts: 1 slide per page',
    'handouts_2_horizontal': 'Handouts: 2 slides per page (horizontal)',
    'handouts_2_vertical': 'Handouts: 2 slides per page (vertical)',
    'handouts_3': 'Handouts: 3 slides per page (with lines for notes)',
    'handouts_4_horizontal': 'Handouts: 4 slides per page (2×2 grid)',
    'handouts_6_horizontal': 'Handouts: 6 slides per page (2×3 grid)',
    'handouts_9_horizontal': 'Handouts: 9 slides per page (3×3 grid)',
  };
  
  return descriptions[layout] || layout;
}

/**
 * Get slides per page from print layout
 */
function getSlidesPerPageFromLayout(layout) {
  const mapping = {
    'full_page_slides': 1,
    'notes_pages': 1,
    'outline': 1,
    'handouts_1': 1,
    'handouts_2_horizontal': 2,
    'handouts_2_vertical': 2,
    'handouts_3': 3,
    'handouts_4_horizontal': 4,
    'handouts_6_horizontal': 6,
    'handouts_9_horizontal': 9,
  };
  
  return mapping[layout] || 1;
}

module.exports = {
  isPresentationFile,
  isPresentationPDF,
  getSmartPresentationConfig,
  applySmartPresentationConfig,
  getPrintLayoutDescription,
  getSlidesPerPageFromLayout,
  PRESENTATION_EXTENSIONS,
  PRESENTATION_MIME_TYPES,
};
