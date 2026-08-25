'use strict';

/**
 * ghostscript.js — PDF → PostScript / PCL conversion via Ghostscript
 *
 * When a printer doesn't support application/pdf natively (common on older
 * Canon iR-ADV models that don't have PDL→PDF enabled), we convert the PDF
 * to a format the printer DOES support before sending via IPP.
 *
 * Conversion priority:
 *   1. application/pdf         → send as-is (no conversion needed)
 *   2. application/postscript  → Ghostscript PDF→PS
 *   3. application/vnd.hp-PCL  → Ghostscript PDF→PCL
 *   4. application/octet-stream → send PDF bytes as-is (Canon with PDL enabled)
 *
 * Ghostscript must be installed:
 *   Windows:  choco install ghostscript  (or download from https://ghostscript.com)
 *   Linux:    apt-get install ghostscript
 *   macOS:    brew install ghostscript
 *
 * The binary is auto-detected: gs (Linux/Mac) or gswin64c.exe (Windows).
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('../config/logger');

// ─── Ghostscript binary auto-detection ──────────────────────────────────────
let _gsBinary = null;

function findGhostscript() {
  if (_gsBinary) return _gsBinary;

  const candidates = os.platform() === 'win32'
    ? ['gswin64c.exe', 'gswin64c', 'gswin32c.exe', 'gswin32c', 'gs']
    : ['gs'];

  for (const bin of candidates) {
    try {
      require('child_process').execFileSync(bin, ['--version'], {
        stdio: 'pipe',
        timeout: 5000,
      });
      _gsBinary = bin;
      logger.info(`[GS] Found Ghostscript binary: ${bin}`);
      return bin;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

/**
 * Check if Ghostscript is available on this system.
 * @returns {{ available: boolean, binary: string|null, version: string|null }}
 */
function isGhostscriptAvailable() {
  const bin = findGhostscript();
  if (!bin) return { available: false, binary: null, version: null };

  try {
    const version = require('child_process')
      .execFileSync(bin, ['--version'], { stdio: 'pipe', timeout: 5000 })
      .toString()
      .trim();
    return { available: true, binary: bin, version };
  } catch {
    return { available: false, binary: bin, version: null };
  }
}

/**
 * Convert a PDF buffer to PostScript using Ghostscript.
 * @param {Buffer} pdfBuffer - Input PDF data
 * @param {Object} options - Conversion options (e.g. { sides: 'double' })
 * @returns {Promise<Buffer>} - PostScript output
 */
async function pdfToPostScript(pdfBuffer, options = {}) {
  return convertWithGhostscript(pdfBuffer, 'ps2write', '.ps', options);
}

/**
 * Convert a PDF buffer to PCL using Ghostscript.
 * @param {Buffer} pdfBuffer - Input PDF data
 * @param {Object} options - Conversion options (e.g. { sides: 'double' })
 * @returns {Promise<Buffer>} - PCL output
 */
async function pdfToPCL(pdfBuffer, options = {}) {
  return convertWithGhostscript(pdfBuffer, 'pxlcolor', '.pcl', options);
}

/**
 * Core conversion: writes PDF to temp file, runs Ghostscript, reads output.
 * Uses temp files because Ghostscript doesn't support stdin/stdout for all devices.
 */
async function convertWithGhostscript(pdfBuffer, device, ext, options = {}) {
  const gsBin = findGhostscript();
  if (!gsBin) {
    throw new Error('Ghostscript not installed. Install with: apt-get install ghostscript (Linux) or choco install ghostscript (Windows)');
  }

  const tmpDir = os.tmpdir();
  const id = `gs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inputPath = path.join(tmpDir, `${id}_input.pdf`);
  const outputPath = path.join(tmpDir, `${id}_output${ext}`);

  try {
    // Write input PDF to temp file
    fs.writeFileSync(inputPath, pdfBuffer);

    // Build Ghostscript args — optimized for speed on constrained servers
    const args = [
      '-q',                     // Quiet mode
      '-dNOPAUSE',              // Don't pause between pages
      '-dBATCH',                // Exit after processing
      `-sDEVICE=${device}`,     // Output device (ps2write, pxlcolor, etc.)
      '-dCompatibilityLevel=1.4', // PDF 1.4 compatibility
      '-dNOGC',                 // Skip GS garbage collection (faster)
      '-dNumRenderingThreads=2', // Use 2 threads for rendering
    ];

    // Duplex support
    if (options.sides === 'double') {
      args.push('-dDuplex=true', '-dTumble=false');
    }

    // Resolution: PostScript uses 300 DPI (printer re-rasterizes at its own native DPI).
    // PCL keeps 600 DPI because it's sent as a raster stream.
    if (device === 'ps2write') {
      args.splice(5, 0, '-r300');
    } else if (device === 'pxlcolor') {
      args.splice(5, 0, '-r600');
    }

    args.push(`-sOutputFile=${outputPath}`);

    // PostScript native duplex command compilation (must be passed via -c before input file)
    if ((device === 'ps2write' || ext === '.ps') && options.sides === 'double') {
      args.push('-c', '<< /Duplex true /Tumble false >> setpagedevice', '-f', inputPath);
    } else {
      args.push(inputPath);
    }

    logger.info(`[GS] Converting: ${gsBin} ${args.join(' ')}`);

    // Execute Ghostscript
    await new Promise((resolve, reject) => {
      const proc = execFile(gsBin, args, {
        timeout: 60000, // 60 second timeout
        maxBuffer: 50 * 1024 * 1024, // 50MB max output
      }, (err, stdout, stderr) => {
        if (err) {
          logger.error(`[GS] Conversion failed: ${err.message}`);
          if (stderr) logger.error(`[GS] stderr: ${stderr}`);
          return reject(new Error(`Ghostscript conversion failed: ${err.message}`));
        }
        if (stderr && stderr.includes('Error')) {
          logger.warn(`[GS] warnings: ${stderr}`);
        }
        resolve();
      });
    });

    // Read output file
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Ghostscript produced no output file`);
    }

    let outputBuffer = fs.readFileSync(outputPath);

    if (device === 'pxlcolor' || ext === '.pcl') {
      // For PCL, PJL is the correct and only way
      const pjlHeader = options.sides === 'double'
        ? '\x1B%-12345X@PJL JOB\r\n@PJL SET DUPLEX=ON\r\n@PJL SET BINDING=LONGEDGE\r\n@PJL ENTER LANGUAGE=PCLXL\r\n'
        : '\x1B%-12345X@PJL JOB\r\n@PJL SET DUPLEX=OFF\r\n@PJL ENTER LANGUAGE=PCLXL\r\n';
      const pjlFooter = '\x1B%-12345X@PJL EOJ\r\n\x1B%-12345X';
      outputBuffer = Buffer.concat([Buffer.from(pjlHeader), outputBuffer, Buffer.from(pjlFooter)]);
      logger.info(`[GS] Injected PJL headers and EOJ trailer for PCL stream (Duplex=${options.sides === 'double'})`);
    }

    logger.info(`[GS] Conversion complete: ${pdfBuffer.length} bytes PDF → ${outputBuffer.length} bytes ${ext.replace('.', '').toUpperCase()}`);

    return outputBuffer;

  } finally {
    // Cleanup temp files
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
  }
}

/**
 * Convert a PDF buffer to the target MIME type if needed.
 * Returns { buffer, mimeType } — buffer may be unchanged if no conversion needed.
 *
 * @param {Buffer} pdfBuffer - Input PDF data
 * @param {string} targetFormat - Target MIME type (e.g. 'application/postscript')
 * @param {string[]} supportedFormats - All formats the printer supports
 * @param {Object} options - Conversion options (e.g. { sides: 'double' })
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
async function convertForPrinter(pdfBuffer, targetFormat, supportedFormats = [], options = {}) {
  // No conversion needed for these formats
  if (targetFormat === 'application/pdf' || targetFormat === 'application/octet-stream') {
    return { buffer: pdfBuffer, mimeType: targetFormat };
  }

  // PostScript conversion
  if (targetFormat === 'application/postscript') {
    logger.info(`[GS] Converting PDF → PostScript for printer (sides: ${options.sides || 'single'})...`);
    const psBuffer = await pdfToPostScript(pdfBuffer, options);
    return { buffer: psBuffer, mimeType: 'application/postscript' };
  }

  // PCL conversion
  if (targetFormat === 'application/vnd.hp-PCL' || targetFormat === 'application/x-pcl') {
    logger.info(`[GS] Converting PDF → PCL for printer (sides: ${options.sides || 'single'})...`);
    const pclBuffer = await pdfToPCL(pdfBuffer, options);
    return { buffer: pclBuffer, mimeType: targetFormat };
  }

  // Unknown format — try PostScript if printer supports it (most do)
  if (supportedFormats.includes('application/postscript')) {
    logger.warn(`[GS] Unknown target format '${targetFormat}', trying PostScript (sides: ${options.sides || 'single'})...`);
    const psBuffer = await pdfToPostScript(pdfBuffer, options);
    return { buffer: psBuffer, mimeType: 'application/postscript' };
  }

  // Can't convert — return PDF as-is and hope for the best
  logger.warn(`[GS] Cannot convert to '${targetFormat}', sending PDF as-is`);
  return { buffer: pdfBuffer, mimeType: 'application/pdf' };
}

module.exports = {
  isGhostscriptAvailable,
  pdfToPostScript,
  pdfToPCL,
  convertForPrinter,
};
