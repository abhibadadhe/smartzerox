import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, X, Info } from 'lucide-react';
import { Label } from './label';
import RealPDFPreview from './RealPDFPreview';

/**
 * Enhanced selector with visual preview for pages per sheet options
 * Can show real PDF preview if file is provided
 */
const PagesPerSheetSelector = ({ value = 1, onChange, file = null, rangeStart = 1, rangeEnd = null, orientation = 'portrait' }) => {
  const [showPreview, setShowPreview] = useState(false);
  const [previewLayout, setPreviewLayout] = useState(value);

  const options = [
    { value: 1, label: '1 Page', layout: '1×1', description: 'Standard full-page', cols: 1, rows: 1 },
    { value: 2, label: '2 Pages', layout: orientation === 'landscape' ? '1×2' : '2×1', description: orientation === 'landscape' ? 'Top and bottom' : 'Side by side', cols: orientation === 'landscape' ? 1 : 2, rows: orientation === 'landscape' ? 2 : 1 },
    { value: 4, label: '4 Pages', layout: '2×2', description: 'Quad layout', cols: 2, rows: 2 },
    { value: 6, label: '6 Pages', layout: '3×2', description: 'Six-up grid', cols: 3, rows: 2 },
    { value: 9, label: '9 Pages', layout: '3×3', description: 'Nine-up grid', cols: 3, rows: 3 },
    { value: 16, label: '16 Pages', layout: '4×4', description: 'Sixteen-up grid', cols: 4, rows: 4 },
  ];

  const handleSelect = (optionValue) => {
    onChange(optionValue);
    setShowPreview(false);
  };

  const handlePreview = (optionValue) => {
    setPreviewLayout(optionValue);
    setShowPreview(true);
  };

  const selectedOption = options.find(opt => opt.value === value) || options[0];
  const previewOption = options.find(opt => opt.value === previewLayout) || options[0];

  return (
    <div className="relative">
      <Label className="text-xs flex items-center gap-1">
        Pages per Sheet
        <button
          type="button"
          onClick={() => handlePreview(value)}
          className="text-blue-500 hover:text-blue-600 transition-colors"
          title="Show preview"
        >
          <Info className="h-3 w-3" />
        </button>
      </Label>

      {/* Grid of options */}
      <div className="mt-1 grid grid-cols-3 gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleSelect(option.value)}
            onMouseEnter={() => setPreviewLayout(option.value)}
            className={`relative rounded-lg border-2 px-2 py-2 text-xs font-medium transition-all ${
              value === option.value
                ? 'border-primary bg-primary/10 text-primary shadow-sm'
                : 'border-border text-muted-foreground hover:bg-secondary hover:border-primary/50'
            }`}
          >
            <div className="font-semibold">{option.label}</div>
            <div className="text-[10px] opacity-70 mt-0.5">{option.layout}</div>
            
            {/* Mini preview icon */}
            <div className="mt-1 flex items-center justify-center">
              <div
                className="grid gap-[1px] w-6 h-6"
                style={{
                  gridTemplateColumns: `repeat(${option.cols}, 1fr)`,
                  gridTemplateRows: `repeat(${option.rows}, 1fr)`,
                }}
              >
                {Array.from({ length: option.value }).map((_, i) => (
                  <div
                    key={i}
                    className={`rounded-[1px] ${
                      value === option.value ? 'bg-primary' : 'bg-gray-400'
                    }`}
                  />
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Preview Modal */}
      <AnimatePresence>
        {showPreview && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPreview(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
            >
              <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    Layout Preview
                  </h3>
                  <button
                    onClick={() => setShowPreview(false)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* Preview Content */}
                <div className="space-y-4">
                  {/* Current selection info */}
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      <div>
                        <div className="font-semibold text-blue-900 dark:text-blue-100 text-sm">
                          {previewOption.label} per Sheet
                        </div>
                        <div className="text-xs text-blue-700 dark:text-blue-300">
                          {previewOption.layout} grid layout • {previewOption.description}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Visual preview */}
                  {file && file.type === 'application/pdf' ? (
                    // Real PDF preview
                    <RealPDFPreview
                      file={file}
                      pagesPerSheet={previewOption.value}
                      rangeStart={rangeStart}
                      rangeEnd={rangeEnd}
                      orientation={orientation}
                    />
                  ) : (
                    // Generic preview
                    <div className="relative bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 rounded-xl p-6 border-2 border-gray-200 dark:border-gray-700">
                      <div className={`${previewOption.cols <= previewOption.rows ? 'aspect-[1/1.414]' : 'aspect-[1.414/1]'} w-full max-w-xs mx-auto`}>
                        <div
                          className="grid gap-2 h-full w-full"
                          style={{
                            gridTemplateColumns: `repeat(${previewOption.cols}, 1fr)`,
                            gridTemplateRows: `repeat(${previewOption.rows}, 1fr)`,
                          }}
                        >
                          {Array.from({ length: previewOption.value }).map((_, i) => (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ delay: i * 0.05 }}
                              className="relative bg-white dark:bg-gray-800 border-2 border-blue-300 dark:border-blue-600 rounded-lg shadow-sm flex flex-col items-center justify-center overflow-hidden"
                            >
                              {/* Page number */}
                              <div className="absolute top-1 right-1 bg-blue-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                                {i + 1}
                              </div>

                              {/* Page icon */}
                              <FileText className="w-1/3 h-1/3 text-blue-400 dark:text-blue-500 opacity-50" />

                              {/* Simulated text lines */}
                              <div className="absolute inset-0 p-2 flex flex-col gap-1 opacity-20">
                                {Array.from({ length: Math.min(previewOption.rows * 2, 5) }).map((_, lineIdx) => (
                                  <div
                                    key={lineIdx}
                                    className="h-0.5 bg-gray-600 dark:bg-gray-400 rounded"
                                    style={{ width: `${50 + Math.random() * 40}%` }}
                                  />
                                ))}
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>

                      {/* Sheet label */}
                      <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 px-3 py-1 rounded-full border-2 border-gray-300 dark:border-gray-600 shadow-sm">
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                          1 Physical Sheet
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Benefits */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-gray-700 dark:text-gray-300">
                        Saves paper: {previewOption.value} pages → 1 sheet
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className="text-gray-700 dark:text-gray-300">
                        Reduces printing cost
                      </span>
                    </div>
                    {previewOption.value >= 9 && (
                      <div className="flex items-center gap-2 text-xs">
                        <div className="w-2 h-2 rounded-full bg-amber-500" />
                        <span className="text-amber-700 dark:text-amber-400">
                          Text will be smaller - best for reference materials
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => {
                        handleSelect(previewLayout);
                      }}
                      className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                      Select This Layout
                    </button>
                    <button
                      onClick={() => setShowPreview(false)}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PagesPerSheetSelector;
