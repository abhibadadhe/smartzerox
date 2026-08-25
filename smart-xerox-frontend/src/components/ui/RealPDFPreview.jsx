import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { FileText, Loader2, AlertCircle } from 'lucide-react';

/**
 * Real PDF Preview Component
 * Shows actual PDF pages in N-up layout using canvas rendering
 * Works with File objects or URLs
 */
const RealPDFPreview = ({ file, pagesPerSheet = 1, rangeStart = 1, rangeEnd = null, orientation = 'portrait' }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageImages, setPageImages] = useState([]);
  const canvasRefs = useRef([]);

  // Layout configurations
  const layouts = {
    1: { cols: 1, rows: 1 },
    2: orientation === 'landscape' ? { cols: 1, rows: 2 } : { cols: 2, rows: 1 },
    4: { cols: 2, rows: 2 },
    6: { cols: 3, rows: 2 },
    9: { cols: 3, rows: 3 },
    16: { cols: 4, rows: 4 },
  };

  const layout = layouts[pagesPerSheet] || layouts[1];
  const { cols, rows } = layout;

  const isPortrait = cols <= rows;
  const containerAspect = isPortrait ? 'aspect-[1/1.414]' : 'aspect-[1.414/1]'; // A4 ratio

  useEffect(() => {
    if (!file) return;

    const loadPDF = async () => {
      setLoading(true);
      setError(null);

      try {
        // Dynamically import pdfjs-dist to avoid SSR issues
        const pdfjsLib = await import('pdfjs-dist');
        
        // Set worker path
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

        // Load PDF from file
        let pdfData;
        if (file instanceof File) {
          const arrayBuffer = await file.arrayBuffer();
          pdfData = new Uint8Array(arrayBuffer);
        } else if (typeof file === 'string') {
          // URL
          pdfData = file;
        } else {
          throw new Error('Invalid file type');
        }

        const pdf = await pdfjsLib.getDocument(pdfData).promise;
        const totalPages = pdf.numPages;
        
        // Determine which pages to render
        const startPage = Math.max(1, rangeStart);
        const endPage = Math.min(rangeEnd || totalPages, totalPages);
        const pagesToRender = Math.min(pagesPerSheet, endPage - startPage + 1);

        // Render pages
        const images = [];
        for (let i = 0; i < pagesToRender; i++) {
          const pageNum = startPage + i;
          if (pageNum > endPage) break;

          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.5 });

          // Create canvas
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          // Render page
          await page.render({
            canvasContext: context,
            viewport: viewport,
          }).promise;

          // Convert to image
          images.push({
            dataUrl: canvas.toDataURL(),
            pageNum: pageNum,
          });
        }

        setPageImages(images);
        setLoading(false);
      } catch (err) {
        console.error('PDF loading error:', err);
        setError(err.message || 'Failed to load PDF');
        setLoading(false);
      }
    };

    loadPDF();
  }, [file, pagesPerSheet, rangeStart, rangeEnd]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 bg-gray-50 dark:bg-gray-900 rounded-lg">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto mb-2" />
          <p className="text-sm text-gray-600 dark:text-gray-400">Loading PDF preview...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-8 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-700">
        <div className="text-center">
          <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="space-y-3"
    >
      {/* Header */}
      <div className="text-center">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {pagesPerSheet === 1 ? 'Full Page Preview' : `${pagesPerSheet} Pages per Sheet`}
        </h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Showing pages {rangeStart} - {Math.min(rangeStart + pagesPerSheet - 1, rangeEnd || rangeStart + pagesPerSheet - 1)}
        </p>
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
            {Array.from({ length: pagesPerSheet }).map((_, index) => {
              const pageImage = pageImages[index];
              
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05, duration: 0.2 }}
                  className="relative bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded overflow-hidden group"
                >
                  {pageImage ? (
                    <>
                      {/* Actual PDF page */}
                      <img
                        src={pageImage.dataUrl}
                        alt={`Page ${pageImage.pageNum}`}
                        className="w-full h-full object-contain"
                      />
                      
                      {/* Page number badge */}
                      <div className="absolute top-1 right-1 bg-blue-600 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow-md z-10">
                        {pageImage.pageNum}
                      </div>

                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/10 transition-colors pointer-events-none" />
                    </>
                  ) : (
                    // Placeholder for empty slots
                    <div className="w-full h-full flex items-center justify-center">
                      <FileText className="w-1/3 h-1/3 text-gray-400 opacity-30" />
                    </div>
                  )}
                </motion.div>
              );
            })}
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
        <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-1 rounded-full text-[10px] font-medium border border-blue-200 dark:border-blue-700">
          {pageImages.length} page{pageImages.length !== 1 ? 's' : ''} shown
        </div>
        {pagesPerSheet > 1 && (
          <>
            <div className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded-full text-[10px] font-medium border border-green-200 dark:border-green-700">
              ✓ Saves paper
            </div>
            <div className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-2 py-1 rounded-full text-[10px] font-medium border border-purple-200 dark:border-purple-700">
              {pagesPerSheet}:1 ratio
            </div>
          </>
        )}
      </div>

      {/* Warning for large layouts */}
      {pagesPerSheet >= 9 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-2 text-center">
          <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
            ⚠️ Text will be very small at this layout. Best for reference materials.
          </p>
        </div>
      )}
    </motion.div>
  );
};

export default RealPDFPreview;
