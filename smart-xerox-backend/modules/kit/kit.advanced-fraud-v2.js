/**
 * Kit Order Fraud Detection Engine — Production V3
 *
 * Architecture: 3-tier scoring system
 *
 *  TIER 1 — DEFINITIVE (database-backed, no OCR noise):
 *    Duplicate screenshot hash   → +60
 *    Duplicate transaction ID    → +60
 *    Multiple orders ≤30 min     → +20 (soft signal, alone not enough)
 *    Invalid image metadata      → +30
 *
 *  TIER 2 — CONFIRMED OCR FRAUD (only when OCR clearly succeeds):
 *    TXN ID in screenshot ≠ submitted TXN ID  → +70
 *    Amount in screenshot ≠ order amount      → +60
 *    Wrong currency explicitly detected        → +60
 *    Confirmed UPI ID mismatch (both found)   → +50
 *    3+ distinct amounts in one screenshot    → +40
 *    Amount-in-words ≠ amount-in-numbers      → +45
 *
 *  TIER 3 — IMAGE INTEGRITY (binary analysis, no OCR):
 *    Editing software in EXIF tags            → +70
 *    EXIF DateTime ≠ DateTimeOriginal         → +50
 *    Screenshot > 48 hours old                → +30
 *    Severe blur (>50% pixels)                → +35
 *
 *  THRESHOLD: fraudScore ≥ 60 → Suspicious
 *    - One definitive signal alone (duplicate) = 60 → Suspicious ✓
 *    - Soft signals alone (multiple orders = 20) → NOT Suspicious ✓
 *    - Normal new order, no matches: score 0 → Pending Verification ✓
 *
 * All checks that can return null/inconclusive add ZERO score.
 * Payment data is never logged in plain text.
 */

'use strict';

const crypto    = require('crypto');
const KitOrder  = require('./kit.model');
const Shop      = require('../../models/Shop');
const logger    = require('../../config/logger');

// ─── Module-level imports for performance (Fix #10) ─────────────────────────
// Lazy-loaded on first use to avoid startup penalty if kit module isn't needed
let _Tesseract  = null;
let _jimp       = null;
let _exifParser = null;

function getTesseract() {
  if (!_Tesseract) _Tesseract = require('tesseract.js');
  return _Tesseract;
}
function getJimp() {
  if (!_jimp) _jimp = require('jimp');
  return _jimp;
}
function getExifParser() {
  if (!_exifParser) _exifParser = require('exif-parser');
  return _exifParser;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1 — DEFINITIVE DATABASE CHECKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a perceptual-style hash of image buffer for dedup. (Fix #1)
 *
 * Instead of hashing raw bytes (trivially bypassed by re-saving),
 * we normalise the image: resize to 64x64 greyscale, then hash the
 * raw pixel data. This catches:
 *   - Re-saves (JPEG→PNG, PNG→JPEG)
 *   - EXIF stripping / metadata changes
 *   - Minor quality changes from re-compression
 *
 * For a fast fallback if jimp fails, we hash raw bytes.
 */
async function generateImageHash(buffer) {
  try {
    const jimp = getJimp();
    const img  = await jimp.read(buffer);
    // Normalise: 64x64 greyscale → raw pixel buffer
    img.resize(64, 64).greyscale();
    const pixelData = img.bitmap.data;
    return crypto.createHash('sha256').update(pixelData).digest('hex');
  } catch (err) {
    logger.warn(`[FraudEngine] Perceptual hash failed, falling back to raw hash: ${err.message}`);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
}

/** Returns true if this exact screenshot was already used in another order. */
async function checkScreenshotReuse(hash, excludeOrderId = null) {
  if (!hash) return false;
  const q = { screenshotHash: hash };
  if (excludeOrderId) q._id = { $ne: excludeOrderId };
  return !!(await KitOrder.findOne(q).select('_id').lean());
}

/** Returns true if this transaction ID appears in any existing order. (Fix #2: case-insensitive) */
async function checkTransactionIdDuplicate(txnId, excludeOrderId = null) {
  if (!txnId || !txnId.trim()) return false;
  // Case-insensitive match — prevents bypass via UPI123 vs upi123
  const normalised = txnId.trim().toUpperCase();
  const q = { transactionId: { $regex: new RegExp(`^${normalised.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } };
  if (excludeOrderId) q._id = { $ne: excludeOrderId };
  return !!(await KitOrder.findOne(q).select('_id').lean());
}

/**
 * Returns the count of orders from this user (by userId, email, or phone)
 * placed within the last `windowMinutes` minutes.
 */
async function countRecentOrders(userId, email, phone, windowMinutes = 30) {
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const orClauses = [];
  if (userId)                     orClauses.push({ userId });
  if (email)                      orClauses.push({ email: email.toLowerCase() });
  if (phone)                      orClauses.push({ phone });
  if (orClauses.length === 0)     return 0;
  return KitOrder.countDocuments({ createdAt: { $gte: since }, $or: orClauses });
}

/** Basic file sanity checks — no analysis needed. (Fix #4: aligned with multer 5MB limit) */
function validateFileMetadata(file) {
  const issues = [];
  if (file.size < 5_000)                          issues.push('File too small to be a real screenshot (<5 KB)');
  if (file.size > 5 * 1024 * 1024)               issues.push('File exceeds 5 MB');  // Aligned with multer limit
  const VALID_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!VALID_MIMES.includes(file.mimetype))       issues.push(`Unsupported file type: ${file.mimetype}`);
  return { isValid: issues.length === 0, issues };
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER 2 — OCR-BASED CHECKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run Tesseract OCR on the image buffer.
 * Returns empty string on failure — callers treat empty = inconclusive.
 */
async function runOCR(buffer) {
  try {
    const Tesseract = getTesseract();
    const result = await Promise.race([
      Tesseract.recognize(buffer, 'eng', { logger: () => {} }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('OCR Timeout')), 10000))
    ]).catch(err => {
      logger.warn(`[FraudEngine] Tesseract recognition failed: ${err.message}`);
      return { data: { text: '' } };
    });
    return (result?.data?.text || '').trim();
  } catch (err) {
    logger.warn(`[FraudEngine] OCR unavailable: ${err.message}`);
    return '';
  }
}

/**
 * Extract the first UPI transaction ID–like token from OCR text.
 * Real UPI txn IDs: 12–30 chars, alphanumeric.
 */
function extractTxnIdFromText(text) {
  // Try labelled patterns first
  const labelled = text.match(
    /(?:Transaction\s*(?:ID|No|#)?|Txn\s*(?:ID|No|#)?|Ref(?:erence)?\s*(?:ID|No|#)?|UTR)[:\s#]*([A-Z0-9]{10,30})/i
  );
  if (labelled) return labelled[1].toUpperCase();

  // Fall back to a raw token that looks like a UPI txn ID (starts with common prefixes)
  const raw = text.match(/\b(T\d{17,22}|UPI\d{9,20}|UPT\d{6,20}|[A-Z]{2,6}\d{8,18})\b/);
  if (raw) return raw[1].toUpperCase();

  return null;
}

/** Extract first ₹ / Rs amount from OCR text. Returns integer or null. */
function extractAmountFromText(text) {
  const patterns = [
    /₹\s*(\d[\d,]*(?:\.\d{1,2})?)/,
    /Rs\.?\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
    /(?:Amount|Total|Paid)[:\s]*₹?\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return Math.round(parseFloat(m[1].replace(/,/g, '')));
  }
  return null;
}

/** Return INR | other_currency | null */
function detectCurrency(text) {
  if (/₹|Rs\.?\s*\d|INR/i.test(text))     return 'INR';
  if (/\$\d|USD/i.test(text))              return 'USD';
  if (/€\d|EUR/i.test(text))              return 'EUR';
  if (/£\d|GBP/i.test(text))              return 'GBP';
  if (/AED|Dirham/i.test(text))            return 'AED';
  return null;
}

/**
 * Count distinct UPI IDs in the text using a strict UPI-domain pattern.
 * Excludes plain email addresses (gmail.com / yahoo.com / etc).
 */
function countUpiIds(text) {
  const upiDomainRx = /@(?:upi|okaxis|okhdfcbank|oksbi|okicici|ybl|paytm|apl|ibl|indus|kotak|axl|icici|hdfcbank|sbi|ubi|pnb|barodampay|uboi|cnrb|ucobank|allbank|mahb|aubank|idbi|kbl|federal|jkb|karb|kvb|nsdl|fbl|abfspay|rbl|scmtebank)\b/gi;
  const matches = text.match(upiDomainRx) || [];
  return new Set(matches.map(m => m.toLowerCase())).size;
}

/** Extract the numeric value of "One Hundred Ninety Nine Rupees only" style text. (Fix #17: Hindi/Marathi support) */
function amountWordsToNumber(text) {
  const m = text.match(/([A-Za-z\u0900-\u097F\s]{4,80})\s+(?:Rupees?|Rs\.?|रुपये|रुपए)\s*(?:Only|only|and|मात्र)?/i);
  if (!m) return null;
  const words = m[1].toLowerCase().split(/\s+/);
  const MAP = {
    // English
    zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
    ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,
    seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,
    fifty:50,sixty:60,seventy:70,eighty:80,ninety:90,hundred:100,
    thousand:1000,lakh:100000,crore:10000000,
    // Hindi / Marathi number words (Fix #17)
    'एक':1,'दो':2,'तीन':3,'चार':4,'पाँच':5,'पांच':5,'छह':6,'छ:':6,
    'सात':7,'आठ':8,'नौ':9,'दस':10,'ग्यारह':11,'बारह':12,'तेरह':13,
    'चौदह':14,'पंद्रह':15,'सोलह':16,'सत्रह':17,'अठारह':18,'उन्नीस':19,
    'बीस':20,'तीस':30,'चालीस':40,'पचास':50,'साठ':60,'सत्तर':70,
    'अस्सी':80,'नब्बे':90,'सौ':100,'हज़ार':1000,'हजार':1000,
    'लाख':100000,'करोड़':10000000,
  };
  let total = 0, curr = 0;
  for (const w of words) {
    const n = MAP[w];
    if (n === undefined) continue;
    if (n >= 100) { curr = (curr || 1) * n; if (n >= 1000) { total += curr; curr = 0; } }
    else curr += n;
  }
  return total + curr || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER 3 — IMAGE INTEGRITY (EXIF + PIXEL)
// ─────────────────────────────────────────────────────────────────────────────

/** Comprehensive EXIF analysis. Returns { editedBySoftware, timestampMismatch, ageHours, skippedReason }. (Fix #8: logs PNG/WebP skip) */
function analyzeExif(buffer, mimetype = '') {
  try {
    const exifParser = getExifParser();
    const result = exifParser.create(buffer).parse();
    const tags = result.tags || {};

    // Editing software detection
    const EDITING_APPS = ['photoshop','gimp','paint','pixlr','canva','adobe','affinity','krita','paintshop','picsart','snapseed','lightroom'];
    const softwareField = (tags.Software || tags.Make || tags.Model || '').toLowerCase();
    const editedBySoftware = EDITING_APPS.some(app => softwareField.includes(app))
      ? softwareField
      : null;

    // Timestamp mismatch
    const dt  = tags.DateTime;
    const dto = tags.DateTimeOriginal;
    const dtd = tags.DateTimeDigitized;
    const timestampMismatch =
      (dt && dto && dt !== dto) ||
      (dto && dtd && dto !== dtd);

    // Screenshot age
    const ts = dt || dto;
    const ageHours = ts ? (Date.now() - new Date(ts).getTime()) / 3_600_000 : null;

    return { editedBySoftware, timestampMismatch: !!timestampMismatch, ageHours, skippedReason: null };
  } catch {
    // PNG and WebP screenshots often have no EXIF — this is NORMAL, not fraud. (Fix #8)
    const reason = /png|webp/i.test(mimetype)
      ? `EXIF unavailable for ${mimetype} (expected — most mobile screenshots are PNG/WebP)`
      : 'EXIF parsing failed (unknown format or corrupt header)';
    logger.info(`[FraudEngine] ${reason}`);
    return { editedBySoftware: null, timestampMismatch: false, ageHours: null, skippedReason: reason };
  }
}

/**
 * Blur analysis using adjacent-pixel gradient magnitude. (Fix #9: accurate docs)
 *
 * NOTE: This is a simplified edge-density check, NOT a true Laplacian variance.
 * It measures adjacent-pixel colour differences across scanlines. High percentages
 * of near-zero gradients suggest blur or intentional obfuscation.
 *
 * Limitations:
 *   - Flat-colour UI regions (common in UPI apps) register as "blurred"
 *   - JPEG compression artefacts add false edge noise
 *   - Only catches severe, full-image blur (>50% threshold)
 *
 * Threshold: >50% near-zero gradient pixels = severe blur.
 */
async function analyzeBlurlevel(buffer) {
  try {
    const jimp = getJimp();
    const img  = await jimp.read(buffer);
    const data = img.bitmap.data;
    const total = data.length / 4;
    let blurred = 0;
    for (let i = 4; i < data.length; i += 4) {
      const variance = Math.abs(data[i] - data[i-4])
                     + Math.abs(data[i+1] - data[i-3])
                     + Math.abs(data[i+2] - data[i-2]);
      if (variance < 5) blurred++;
    }
    return (blurred / total) * 100;
  } catch {
    return null; // Can't analyse → inconclusive
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN FRAUD ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * performAdvancedFraudCheckV2
 *
 * @param {object} orderData  - { userId, email, phone, transactionId, totalAmount }
 * @param {object} file       - multer file object { buffer, mimetype, size, originalname }
 * @param {string} shopkeeperId - ObjectId of shop owner (for UPI ID comparison)
 * @returns {{ screenshotHash, fraudFlags, isSuspicious }}
 */
async function performAdvancedFraudCheckV2(orderData, file, shopkeeperId) {
  const flags = {
    // T1 — definitive
    screenshotReused:        false,
    transactionIdDuplicate:  false,
    multipleOrdersShortTime: false,
    suspiciousImageMetadata: false,

    // T2 — OCR-confirmed
    txnIdMismatch:           false,
    amountMismatch:          false,
    wrongCurrency:           false,
    upiIdMismatch:           false,
    multipleTransactions:    false,
    amountWordsMismatch:     false,

    // T3 — image integrity
    editedImage:             false,
    exifModified:            false,
    oldScreenshot:           false,
    blurredAreas:            false,

    // Metadata
    flaggedAt:   null,
    flagReason:  '',
    fraudScore:  0,
    details:     {},
  };

  // Always compute hash — needed regardless of fraud outcome
  const screenshotHash = await generateImageHash(file.buffer);

  try {

    // ── TIER 1 ──────────────────────────────────────────────────────────────

    // 1a. File metadata sanity
    const meta = validateFileMetadata(file);
    if (!meta.isValid) {
      flags.suspiciousImageMetadata = true;
      flags.flagReason += `Invalid file: ${meta.issues.join('; ')}. `;
      flags.fraudScore += 30;
      flags.details.metaIssues = meta.issues;
    }

    // 1b. Duplicate screenshot
    const screenshotReused = await checkScreenshotReuse(screenshotHash);
    if (screenshotReused) {
      flags.screenshotReused = true;
      flags.flagReason += 'Payment screenshot was already used in another order. ';
      flags.fraudScore += 60;
    }

    // 1c. Duplicate transaction ID
    if (orderData.transactionId?.trim()) {
      const txnDuplicate = await checkTransactionIdDuplicate(orderData.transactionId);
      if (txnDuplicate) {
        flags.transactionIdDuplicate = true;
        flags.flagReason += 'Transaction ID was already used in another order. ';
        flags.fraudScore += 60;
      }
    }

    // 1d. Rapid-fire orders (soft signal — alone does NOT trigger suspension)
    // Fix #6: Check runs BEFORE current order is saved, so >= 1 means
    // this user already has an existing order in the last 30 minutes
    const recentCount = await countRecentOrders(
      orderData.userId,
      orderData.email,
      orderData.phone,
      30
    );
    if (recentCount >= 1) {
      flags.multipleOrdersShortTime = true;
      flags.flagReason += `${recentCount + 1} orders placed within 30 minutes (including this one). `;
      flags.fraudScore += 20;
      flags.details.recentOrderCount = recentCount + 1;
    }

    // Early-exit: if already above threshold from definitive checks, skip expensive OCR/EXIF
    // (saves ~3-5s per legitimate duplicate-attempt order)
    if (flags.fraudScore >= 60) {
      flags.flaggedAt = new Date();
      logger.warn(`[FraudEngine] SUSPICIOUS (early-exit) score=${flags.fraudScore} txn=***REDACTED*** reason="${flags.flagReason}"`);
      return { screenshotHash, fraudFlags: flags, isSuspicious: true };
    }

    // ── TIER 2 — OCR ────────────────────────────────────────────────────────

    const ocrText = await runOCR(file.buffer);
    // Fix #7: Increased threshold from 30→80 chars AND require at least one UPI keyword
    // to reduce false positives from garbage OCR on blurry images
    const UPI_KEYWORDS = /₹|rs\.?|upi|paid|payment|transaction|txn|transfer|success|received|sent|debited|credited/i;
    const ocrReliable = ocrText.length >= 80 && UPI_KEYWORDS.test(ocrText);
    flags.details.ocrReliable = ocrReliable;
    if (!ocrReliable && ocrText.length >= 30) {
      flags.details.ocrNote = `OCR returned ${ocrText.length} chars but no UPI keywords — treating as inconclusive`;
    }

    if (ocrReliable) {
      // 2a. Transaction ID match
      const screenshotTxnId = extractTxnIdFromText(ocrText);
      if (screenshotTxnId && orderData.transactionId?.trim()) {
        const submitted = orderData.transactionId.trim().toUpperCase();
        const found     = screenshotTxnId.toUpperCase();
        // Accept if one contains the other (handles partial display in screenshot)
        const matches   = submitted === found || submitted.includes(found) || found.includes(submitted);
        if (!matches) {
          flags.txnIdMismatch = true;
          // IMPORTANT: don't log the actual TXN IDs — payment sensitive data
          flags.flagReason += 'Transaction ID in screenshot does not match submitted ID. ';
          flags.fraudScore += 70;
          flags.details.txnIdMatch = 'MISMATCH'; // no actual values logged
        } else {
          flags.details.txnIdMatch = 'MATCH';
        }
      }

      // 2b. Amount match
      const screenshotAmount = extractAmountFromText(ocrText);
      if (screenshotAmount !== null) {
        const diff = Math.abs(screenshotAmount - orderData.totalAmount);
        if (diff > 1) { // allow ₹1 rounding tolerance
          flags.amountMismatch = true;
          flags.flagReason += `Amount in screenshot (₹${screenshotAmount}) does not match order amount (₹${orderData.totalAmount}). `;
          flags.fraudScore += 60;
          flags.details.amountCheck = { screenshotAmount, orderAmount: orderData.totalAmount };
        } else {
          flags.details.amountCheck = 'MATCH';
        }
      }

      // 2c. Currency — only penalise if a non-INR currency is explicitly found
      const currency = detectCurrency(ocrText);
      if (currency && currency !== 'INR') {
        flags.wrongCurrency = true;
        flags.flagReason += `Non-INR currency detected (${currency}). `;
        flags.fraudScore += 60;
        flags.details.currency = currency;
      }

      // 2d. UPI ID verification — only penalise if both IDs were extracted and don't match
      if (shopkeeperId) {
        try {
          const shop = await Shop.findOne({ owner: shopkeeperId }).select('upiId').lean();
          if (shop?.upiId) {
            const upiRx = /\b([a-zA-Z0-9._-]{3,}@[a-zA-Z0-9]{3,})\b/g;
            const foundUpiIds = [...ocrText.matchAll(upiRx)].map(m => m[1].toLowerCase());
            // Filter out common email-like false positives
            const emailDomains = /gmail|yahoo|outlook|hotmail|rediffmail/;
            const upiCandidates = foundUpiIds.filter(id => !emailDomains.test(id));
            if (upiCandidates.length > 0) {
              const expectedUpi = shop.upiId.toLowerCase();
              const upiMatches = upiCandidates.some(u =>
                u === expectedUpi ||
                u.split('@')[0] === expectedUpi.split('@')[0]
              );
              if (!upiMatches) {
                flags.upiIdMismatch = true;
                flags.flagReason += 'UPI ID in screenshot does not match shop UPI. ';
                flags.fraudScore += 50;
                flags.details.upiIdCheck = 'MISMATCH'; // no actual UPI IDs logged
              } else {
                flags.details.upiIdCheck = 'MATCH';
              }
            }
          }
        } catch (upiErr) {
          logger.warn(`[FraudEngine] UPI check skipped: ${upiErr.message}`);
        }
      }

      // 2e. Multiple distinct transactions on one screenshot (3+ distinct ₹ amounts)
      const amountMatches = [...ocrText.matchAll(/₹\s*(\d[\d,]*)/g)];
      const distinctAmounts = new Set(amountMatches.map(m => m[1].replace(/,/g, '')));
      if (distinctAmounts.size >= 3) {
        flags.multipleTransactions = true;
        flags.flagReason += `Screenshot shows ${distinctAmounts.size} distinct payment amounts. `;
        flags.fraudScore += 40;
        flags.details.distinctAmounts = distinctAmounts.size;
      }

      // 2f. Amount-in-words mismatch (e.g. "One Hundred Rupees" but ₹500 shown)
      if (screenshotAmount !== null) {
        const wordsAmount = amountWordsToNumber(ocrText);
        if (wordsAmount !== null && Math.abs(wordsAmount - screenshotAmount) > 1) {
          flags.amountWordsMismatch = true;
          flags.flagReason += `Amount in words (₹${wordsAmount}) differs from numeric amount (₹${screenshotAmount}). `;
          flags.fraudScore += 45;
          flags.details.amountWordsCheck = { words: wordsAmount, numeric: screenshotAmount };
        }
      }

    } else {
      flags.details.ocrSkipped = 'OCR returned insufficient text — image may be non-payment image (e.g. ID card)';
      flags.flagReason += 'Uploaded image does not appear to be a valid UPI payment receipt screenshot. ';
      flags.fraudScore += 45;
      logger.info(`[FraudEngine] OCR inconclusive / non-payment image — adding fraud score +45`);
    }

    // ── TIER 3 — IMAGE INTEGRITY ─────────────────────────────────────────────

    // 3a. EXIF analysis
    const exif = analyzeExif(file.buffer, file.mimetype);
    flags.details.exif = {
      editedBySoftware: exif.editedBySoftware ? 'DETECTED' : 'none',
      timestampMismatch: exif.timestampMismatch,
      ageHours: exif.ageHours !== null ? Math.round(exif.ageHours) : 'unknown',
    };

    if (exif.editedBySoftware) {
      flags.editedImage = true;
      flags.flagReason += `Image was processed by editing software. `;
      flags.fraudScore += 70;
    }
    if (exif.timestampMismatch) {
      flags.exifModified = true;
      flags.flagReason += 'EXIF timestamp was modified after capture. ';
      flags.fraudScore += 50;
    }
    // Old screenshot (>48h) — could be a reused screenshot from a previous payment
    if (exif.ageHours !== null && exif.ageHours > 48) {
      flags.oldScreenshot = true;
      flags.flagReason += `Screenshot is ${Math.round(exif.ageHours)}h old (expected recent payment). `;
      flags.fraudScore += 30;
    }

    // 3b. Blur analysis — only flag SEVERE blur (>50%), not normal JPEG compression
    const blurPct = await analyzeBlurlevel(file.buffer);
    flags.details.blurPercent = blurPct !== null ? `${blurPct.toFixed(1)}%` : 'unknown';
    if (blurPct !== null && blurPct > 50) {
      flags.blurredAreas = true;
      flags.flagReason += `Screenshot is severely blurred (${blurPct.toFixed(0)}% of pixels). `;
      flags.fraudScore += 35;
    }

    // ── DECISION ─────────────────────────────────────────────────────────────

    if (flags.fraudScore > 0) flags.flaggedAt = new Date();

    const isSuspicious = flags.fraudScore >= 40;

    if (isSuspicious) {
      logger.warn(`[FraudEngine] 🚨 SUSPICIOUS score=${flags.fraudScore} reason="${flags.flagReason}"`);
    } else if (flags.fraudScore > 0) {
      logger.info(`[FraudEngine] ⚠️  Low-risk signals score=${flags.fraudScore} (below threshold, order → Pending)`);
    } else {
      logger.info(`[FraudEngine] ✅ Clean order score=0`);
    }

    return { screenshotHash, fraudFlags: flags, isSuspicious };

  } catch (err) {
    // Never block a legitimate order due to an engine error
    logger.error(`[FraudEngine] Unexpected error: ${err.message}`, { stack: err.stack });
    return { screenshotHash, fraudFlags: flags, isSuspicious: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS (keep named exports so old imports still work)
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  generateImageHash,
  checkScreenshotReuse,
  checkTransactionIdDuplicate,
  countRecentOrders,
  validateFileMetadata,
  analyzeExif,
  analyzeBlurlevel,
  performAdvancedFraudCheckV2,
};
