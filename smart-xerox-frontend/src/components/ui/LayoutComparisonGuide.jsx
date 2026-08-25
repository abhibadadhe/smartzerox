import { motion } from 'framer-motion';
import { FileText, TrendingDown, AlertCircle } from 'lucide-react';

/**
 * Educational guide showing comparison between different N-up layouts
 * Can be used in help sections or onboarding
 */
const LayoutComparisonGuide = () => {
  const comparisons = [
    {
      pagesPerSheet: 1,
      layout: '1×1',
      paperSaved: '0%',
      readability: 'Excellent',
      useCase: 'Standard documents, presentations',
      color: 'blue',
      icon: '📄',
    },
    {
      pagesPerSheet: 2,
      layout: '2×1',
      paperSaved: '50%',
      readability: 'Very Good',
      useCase: 'Handouts, notes, reading materials',
      color: 'green',
      icon: '📋',
    },
    {
      pagesPerSheet: 4,
      layout: '2×2',
      paperSaved: '75%',
      readability: 'Good',
      useCase: 'Study materials, reference docs',
      color: 'emerald',
      icon: '📚',
    },
    {
      pagesPerSheet: 6,
      layout: '3×2',
      paperSaved: '83%',
      readability: 'Fair',
      useCase: 'Quick reference, summaries',
      color: 'amber',
      icon: '📑',
    },
    {
      pagesPerSheet: 9,
      layout: '3×3',
      paperSaved: '89%',
      readability: 'Small',
      useCase: 'Overview, thumbnails',
      color: 'orange',
      icon: '🗂️',
    },
    {
      pagesPerSheet: 16,
      layout: '4×4',
      paperSaved: '94%',
      readability: 'Very Small',
      useCase: 'Thumbnails only',
      color: 'red',
      icon: '🔍',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Pages per Sheet Comparison
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Choose the right layout for your needs
        </p>
      </div>

      {/* Comparison Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {comparisons.map((item, index) => (
          <motion.div
            key={item.pagesPerSheet}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="bg-white dark:bg-gray-800 rounded-xl border-2 border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-shadow"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{item.icon}</span>
                <div>
                  <div className="font-bold text-gray-900 dark:text-gray-100">
                    {item.pagesPerSheet} {item.pagesPerSheet === 1 ? 'Page' : 'Pages'}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {item.layout} layout
                  </div>
                </div>
              </div>
            </div>

            {/* Visual Preview */}
            <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-3 mb-3">
              <div
                className="grid gap-1 aspect-[1/1.414] max-w-[120px] mx-auto"
                style={{
                  gridTemplateColumns: `repeat(${Math.sqrt(item.pagesPerSheet) <= 2 ? Math.ceil(Math.sqrt(item.pagesPerSheet)) : Math.ceil(Math.sqrt(item.pagesPerSheet))}, 1fr)`,
                  gridTemplateRows: `repeat(${Math.sqrt(item.pagesPerSheet) <= 2 ? Math.ceil(item.pagesPerSheet / Math.ceil(Math.sqrt(item.pagesPerSheet))) : Math.ceil(Math.sqrt(item.pagesPerSheet))}, 1fr)`,
                }}
              >
                {Array.from({ length: item.pagesPerSheet }).map((_, i) => (
                  <div
                    key={i}
                    className={`bg-${item.color}-200 dark:bg-${item.color}-800 border border-${item.color}-400 dark:border-${item.color}-600 rounded`}
                  />
                ))}
              </div>
            </div>

            {/* Stats */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600 dark:text-gray-400">Paper Saved:</span>
                <span className={`font-bold ${item.pagesPerSheet > 1 ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                  {item.paperSaved}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600 dark:text-gray-400">Readability:</span>
                <span className={`font-bold ${
                  item.readability === 'Excellent' || item.readability === 'Very Good' ? 'text-green-600 dark:text-green-400' :
                  item.readability === 'Good' || item.readability === 'Fair' ? 'text-amber-600 dark:text-amber-400' :
                  'text-red-600 dark:text-red-400'
                }`}>
                  {item.readability}
                </span>
              </div>
            </div>

            {/* Use Case */}
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Best for:</div>
              <div className="text-xs font-medium text-gray-900 dark:text-gray-100">
                {item.useCase}
              </div>
            </div>

            {/* Warning for small layouts */}
            {item.pagesPerSheet >= 9 && (
              <div className="mt-2 flex items-start gap-1 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded p-2">
                <AlertCircle className="h-3 w-3 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <span className="text-[10px] text-amber-700 dark:text-amber-400">
                  Text will be very small
                </span>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Tips Section */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <TrendingDown className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="font-semibold text-blue-900 dark:text-blue-100 text-sm mb-1">
              💡 Pro Tips
            </h4>
            <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1">
              <li>• Use 2-4 pages per sheet for everyday documents</li>
              <li>• Higher layouts work best with simple text documents</li>
              <li>• Consider your audience's eyesight and reading distance</li>
              <li>• Test with a single sheet before printing large batches</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LayoutComparisonGuide;
