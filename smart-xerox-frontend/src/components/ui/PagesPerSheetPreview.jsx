import { motion } from 'framer-motion';
import { FileText } from 'lucide-react';

/**
 * Visual preview component showing how pages will be arranged on a sheet
 * when using N-up printing (multiple pages per sheet)
 */
const PagesPerSheetPreview = ({ pagesPerSheet = 1, orientation = 'portrait', isImage = false, imageOptions = null }) => {
  // Image/Photo layout preview branch
  if (isImage && imageOptions) {
    const printType = imageOptions.printType || 'full_page';
    const paperType = imageOptions.paperType || 'plain';
    const drawCutLines = imageOptions.drawCutLines ?? true;

    let previewTitle = 'Full Page Photo';
    let previewDesc = 'Single photo scaled to fit paper';
    let cellsCount = 1;
    let gridCols = 1;
    let gridRows = 1;

    if (printType === 'passport_grid') {
      previewTitle = 'Passport Size Grid';
      previewDesc = '9 photos (3.5 × 4.5 cm each) arranged in 3×3 grid';
      cellsCount = 9;
      gridCols = 3;
      gridRows = 3;
    } else if (printType === 'stamp_grid') {
      previewTitle = 'Stamp Size Grid';
      previewDesc = '40 photos (1.5 × 2.0 cm each) arranged in 5×8 grid';
      cellsCount = 40;
      gridCols = 5;
      gridRows = 8;
    } else if (printType === 'custom_size') {
      previewTitle = `Custom Size (${imageOptions.customWidthCm} × ${imageOptions.customHeightCm} cm)`;
      previewDesc = 'One custom-sized photo centered on sheet';
    }

    const containerAspect = 'aspect-[1/1.414]'; // A4 Ratio

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="space-y-3"
      >
        {/* Header */}
        <div className="text-center">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{previewTitle}</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{previewDesc}</p>
        </div>

        {/* Preview Sheet */}
        <div className={`relative bg-white dark:bg-gray-800 rounded-lg shadow-lg border-2 ${paperType === 'glossy' ? 'border-amber-400 ring-2 ring-amber-400/20' : 'border-gray-200 dark:border-gray-700'} p-4`}>
          {paperType === 'glossy' && (
            <div className="absolute top-2 left-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[9px] font-bold rounded px-1.5 py-0.5 shadow-sm uppercase tracking-wider z-10">
              Glossy Paper
            </div>
          )}
          
          <div className={`w-full ${containerAspect} mx-auto bg-gray-50 dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded p-2 flex items-center justify-center overflow-hidden`}>
            {printType === 'full_page' ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`w-full h-full bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/20 dark:to-orange-900/20 rounded flex flex-col items-center justify-center ${drawCutLines ? 'border border-dashed border-gray-400' : 'border border-gray-200'}`}
              >
                <div className="text-center p-4">
                  <span className="text-[28px]">🖼️</span>
                  <p className="text-[10px] font-bold text-orange-600 dark:text-orange-400 mt-1">Full Photo Area</p>
                </div>
              </motion.div>
            ) : printType === 'custom_size' ? (
              (() => {
                const wPct = Math.min(100, Math.max(10, (imageOptions.customWidthCm / 21) * 100));
                const hPct = Math.min(100, Math.max(10, (imageOptions.customHeightCm / 29.7) * 100));
                return (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    style={{ width: `${wPct}%`, height: `${hPct}%` }}
                    className={`bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/20 dark:to-orange-900/20 flex flex-col items-center justify-center shadow-md ${drawCutLines ? 'border border-dashed border-gray-400' : 'border border-gray-200'}`}
                  >
                    <div className="text-center p-1 overflow-hidden">
                      <span className="text-[18px]">🖼️</span>
                      <p className="text-[9px] font-semibold text-orange-600 dark:text-orange-400 truncate">
                        {imageOptions.customWidthCm}×{imageOptions.customHeightCm} cm
                      </p>
                    </div>
                  </motion.div>
                );
              })()
            ) : (
              <div
                className="grid gap-0.5 h-full w-full bg-white dark:bg-gray-900"
                style={{
                  gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                  gridTemplateRows: `repeat(${gridRows}, 1fr)`,
                }}
              >
                {Array.from({ length: cellsCount }).map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    className={`bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/10 dark:to-orange-900/10 flex flex-col items-center justify-center ${drawCutLines ? 'border border-dashed border-gray-400' : 'border border-gray-200'}`}
                  >
                    <span className="text-[9px] opacity-75">👤</span>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Sheet label */}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full border border-gray-300 dark:border-gray-600">
            <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-300">
              1 Physical Sheet
            </span>
          </div>
        </div>

        {/* Info badges */}
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <div className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 px-2 py-1 rounded-full text-[10px] font-medium border border-orange-200 dark:border-orange-700">
            ✓ Smart Auto-Tiling
          </div>
          <div className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded-full text-[10px] font-medium border border-amber-200 dark:border-amber-700">
            Paper: {paperType === 'glossy' ? 'Glossy Photo' : 'Plain'}
          </div>
          {drawCutLines && (
            <div className="bg-gray-100 dark:bg-gray-900/30 text-gray-700 dark:text-gray-400 px-2 py-1 rounded-full text-[10px] font-medium border border-gray-200 dark:border-gray-700">
              With Cut Lines
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  // Layout configurations for different N-up formats
  const layouts = {
    1: { cols: 1, rows: 1, label: '1 Page per Sheet', description: 'Standard full-page printing' },
    2: orientation === 'landscape'
      ? { cols: 1, rows: 2, label: '2 Pages per Sheet', description: '1×2 layout (portrait)' }
      : { cols: 2, rows: 1, label: '2 Pages per Sheet', description: '2×1 layout (landscape)' },
    4: { cols: 2, rows: 2, label: '4 Pages per Sheet', description: '2×2 grid layout' },
    6: { cols: 3, rows: 2, label: '6 Pages per Sheet', description: '3×2 grid layout' },
    9: { cols: 3, rows: 3, label: '9 Pages per Sheet', description: '3×3 grid layout' },
    16: { cols: 4, rows: 4, label: '16 Pages per Sheet', description: '4×4 grid layout' },
  };

  const layout = layouts[pagesPerSheet] || layouts[1];
  const { cols, rows, label, description } = layout;

  // Generate page numbers for preview
  const pages = Array.from({ length: pagesPerSheet }, (_, i) => i + 1);

  // Calculate cell dimensions based on layout
  const isPortrait = cols <= rows;
  const containerAspect = isPortrait ? 'aspect-[1/1.414]' : 'aspect-[1.414/1]'; // A4 ratio

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="space-y-3"
    >
      {/* Header */}
      <div className="text-center">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
      </div>

      {/* Preview Sheet */}
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-lg border-2 border-gray-200 dark:border-gray-700 p-4">
        <div className={`w-full ${containerAspect} mx-auto`}>
          <div
            className="grid gap-1 h-full w-full"
            style={{
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridTemplateRows: `repeat(${rows}, 1fr)`,
            }}
          >
            {pages.map((pageNum) => (
              <motion.div
                key={pageNum}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: pageNum * 0.05, duration: 0.2 }}
                className="relative bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-700 rounded flex flex-col items-center justify-center overflow-hidden group hover:shadow-md transition-shadow"
              >
                {/* Page number badge */}
                <div className="absolute top-1 right-1 bg-blue-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center shadow-sm">
                  {pageNum}
                </div>

                {/* Page icon */}
                <FileText className="w-1/3 h-1/3 text-blue-400 dark:text-blue-500 opacity-40 group-hover:opacity-60 transition-opacity" />

                {/* Page label */}
                <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 mt-1">
                  Page {pageNum}
                </span>

                {/* Decorative lines to simulate text */}
                <div className="absolute inset-0 p-2 flex flex-col gap-0.5 opacity-20">
                  {Array.from({ length: Math.min(rows * 2, 6) }).map((_, i) => (
                    <div
                      key={i}
                      className="h-0.5 bg-blue-400 dark:bg-blue-600 rounded"
                      style={{ width: `${60 + Math.random() * 30}%` }}
                    />
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Sheet label */}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full border border-gray-300 dark:border-gray-600">
          <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-300">
            1 Physical Sheet
          </span>
        </div>
      </div>

      {/* Info badges */}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <div className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded-full text-[10px] font-medium border border-green-200 dark:border-green-700">
          ✓ Saves paper
        </div>
        <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-1 rounded-full text-[10px] font-medium border border-blue-200 dark:border-blue-700">
          {pagesPerSheet} pages → 1 sheet
        </div>
        {pagesPerSheet > 1 && (
          <div className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-2 py-1 rounded-full text-[10px] font-medium border border-purple-200 dark:border-purple-700">
            Smaller text size
          </div>
        )}
      </div>

      {/* Additional info for larger layouts */}
      {pagesPerSheet >= 9 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-2 text-center">
          <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
            ⚠️ Text may be very small. Best for reference materials or handouts.
          </p>
        </div>
      )}
    </motion.div>
  );
};

export default PagesPerSheetPreview;
