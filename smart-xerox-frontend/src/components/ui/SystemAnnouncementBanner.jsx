import React, { useState, useEffect } from 'react';
import { adminAPI } from '@/lib/api';
import { onSystemAnnouncement } from '@/lib/socket';
import { Wrench, AlertTriangle, Info, Bell, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const SystemAnnouncementBanner = () => {
  const [announcement, setAnnouncement] = useState({
    maintenanceMode: false,
    systemAnnouncement: '',
    announcementType: 'maintenance',
  });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Fetch public announcement on mount
    const fetchAnnouncement = async () => {
      try {
        const res = await adminAPI.getPublicAnnouncement();
        const data = res.data?.data || res.data;
        if (data) {
          setAnnouncement({
            maintenanceMode: Boolean(data.maintenanceMode),
            systemAnnouncement: data.systemAnnouncement || '',
            announcementType: data.announcementType || 'maintenance',
          });
        }
      } catch (err) {
        // Silently ignore network errors
      }
    };

    fetchAnnouncement();

    // Subscribe to real-time socket updates
    const cleanup = onSystemAnnouncement((data) => {
      if (data) {
        setAnnouncement({
          maintenanceMode: Boolean(data.maintenanceMode),
          systemAnnouncement: data.systemAnnouncement || '',
          announcementType: data.announcementType || 'maintenance',
        });
        setDismissed(false); // Re-open banner on new broadcast
      }
    });

    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, []);

  const { maintenanceMode, systemAnnouncement, announcementType } = announcement;

  // Hide banner completely if maintenanceMode is false AND systemAnnouncement is empty
  if (dismissed || (!maintenanceMode && !systemAnnouncement)) {
    return null;
  }

  // Only show maintenance badge/styling if maintenanceMode is explicitly TRUE
  const isMaintenance = maintenanceMode;
  const isWarning = !maintenanceMode && announcementType === 'warning';
  const isInfo = !maintenanceMode && announcementType === 'info';

  const bgGradient = isMaintenance
    ? 'bg-gradient-to-r from-red-600 via-rose-600 to-orange-600 text-white'
    : isWarning
    ? 'bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white'
    : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white';

  const IconComponent = isMaintenance ? Wrench : isWarning ? AlertTriangle : isInfo ? Info : Bell;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className={`w-full ${bgGradient} px-4 py-2.5 shadow-md sticky top-0 z-50 flex items-center justify-between text-xs sm:text-sm font-medium`}
      >
        <div className="container mx-auto flex items-center justify-center gap-2.5 text-center pr-6">
          <IconComponent className="h-4 w-4 sm:h-5 sm:w-5 animate-pulse flex-shrink-0" />
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {isMaintenance && (
              <span className="bg-black/25 uppercase font-bold text-[10px] sm:text-xs px-2 py-0.5 rounded-full tracking-wider">
                🛠️ Maintenance Notice
              </span>
            )}
            <span>
              {systemAnnouncement || (isMaintenance ? 'Software is currently under maintenance. Orders may be queued.' : 'Important system notification.')}
            </span>
          </div>
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="text-white/80 hover:text-white p-1 rounded-full hover:bg-black/10 transition-colors flex-shrink-0"
          title="Dismiss notification"
        >
          <X className="h-4 w-4" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
};

export default SystemAnnouncementBanner;
