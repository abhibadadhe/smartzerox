import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { orderAPI, paymentAPI, shopAPI, uploadAPI, userAPI } from '@/lib/api';
import { onOrderUpdate, onPaymentSuccess, onPrintStarted, onPrintCompleted, onPrintProgress, onPrintIssue, joinOrderRoom, joinShopRoom, onShopStatusUpdate } from '@/lib/socket';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileText, Package, X, Loader2, Plus, Trash2, Store, MapPin, RefreshCw, ChevronDown, CheckCircle, CreditCard } from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import PagesPerSheetPreview from '@/components/ui/PagesPerSheetPreview';
import RealPDFPreview from '@/components/ui/RealPDFPreview';

const statusColors = {
  pending_payment: 'bg-yellow-100 text-yellow-800',
  paid:            'bg-blue-100 text-blue-800',
  accepted:        'bg-indigo-100 text-indigo-800',
  printing:        'bg-purple-100 text-purple-800',
  ready:           'bg-green-100 text-green-800',
  picked_up:       'bg-gray-100 text-gray-700',
  cancelled:       'bg-red-100 text-red-800',
  rejected:        'bg-red-100 text-red-800',
  expired:         'bg-orange-100 text-orange-800',
};

const statusLabels = {
  pending_payment: 'Awaiting Payment',
  paid:            'Paid — In Queue',
  queued:          'Queued (Shop Closed)',
  accepted:        'Accepted',
  printing:        'Printing...',
  ready:           '✅ Ready for Pickup!',
  picked_up:       'Collected',
  cancelled:       'Cancelled',
  rejected:        'Rejected',
  expired:         'Expired',
};

// Steps shown in the progress stepper (terminal/cancelled statuses skip it)
const STATUS_STEPS = ['paid', 'queued', 'accepted', 'printing', 'ready', 'picked_up'];
const STEP_LABELS  = { paid: 'Paid', queued: 'Queued', accepted: 'Accepted', printing: 'Printing', ready: 'Ready', picked_up: 'Collected' };

// Helper function to parse comma-separated page ranges like "1,3,5-8,12"
// Returns { pages: valid page numbers, invalid: rejected page numbers/ranges }
const parsePageRange = (rangeStr, maxPage) => {
  if (!rangeStr || String(rangeStr).trim() === '') return { pages: [], invalid: [] };
  const pages = [];
  const invalid = [];
  const parts = String(rangeStr).split(',').map(p => p.trim()).filter(Boolean);
  
  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(n => parseInt(n.trim()));
      if (isNaN(start) || isNaN(end)) {
        invalid.push(part);
      } else if (start < 1 || end > maxPage || start > end) {
        // Page range exceeds PDF page count — reject and warn
        invalid.push(part);
      } else {
        for (let i = start; i <= end; i++) {
          if (!pages.includes(i)) pages.push(i);
        }
      }
    } else {
      const num = parseInt(part);
      if (isNaN(num)) {
        invalid.push(part);
      } else if (num < 1 || num > maxPage) {
        // Page number exceeds PDF page count — reject and warn
        invalid.push(String(num));
      } else if (!pages.includes(num)) {
        pages.push(num);
      }
    }
  }
  return { pages: pages.sort((a, b) => a - b), invalid };
};

const UserDashboard = () => {
  const { user, updateUser } = useAuth();
  const [orders, setOrders]         = useState([]);
  const [activeTab, setActiveTab]   = useState('orders');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loading, setLoading]       = useState(true);

  // Multi-document state — each entry = one uploaded file with its own configs
  const [documents, setDocuments] = useState([]);
  const [activeDocIndex, setActiveDocIndex] = useState(-1); // which doc is being configured
  const [shopInfo, setShopInfo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadStep, setUploadStep] = useState('');
  const [uploadPct, setUploadPct] = useState(0);

  // Shop change state
  const [showShopPicker, setShowShopPicker] = useState(false);
  const [allShops, setAllShops]     = useState([]);
  const [shopsLoading, setShopsLoading] = useState(false);
  const [changingShop, setChangingShop] = useState(false);
  const [currentUser, setCurrentUser] = useState(user);

  // Keep currentUser synced with auth user
  useEffect(() => { setCurrentUser(user); }, [user]);

  // Get shop ID from user (auto-linked during registration)
  const SHOP_ID = currentUser?.shop?._id || currentUser?.shop || null;
  const shopId = SHOP_ID ? String(SHOP_ID) : null;



  // Load all shops for the picker
  const loadAllShops = async () => {
    setShopsLoading(true);
    try {
      const res = await shopAPI.getAll();
      const shops = res.data.data?.shops || res.data?.shops || [];
      setAllShops(shops);
    } catch (err) {
      // Silently fail on network errors
      if (err.code !== 'ERR_NETWORK') {
        toast.error('Failed to load shops');
      }
    } finally {
      setShopsLoading(false);
    }
  };

  // Handle shop change
  const handleChangeShop = async (newShopId) => {
    if (newShopId === shopId) {
      setShowShopPicker(false);
      return;
    }
    setChangingShop(true);
    try {
      const res = await userAPI.changeShop(newShopId);
      const updatedUser = res.data.data?.user || res.data?.user;
      if (updatedUser) {
        setCurrentUser(updatedUser);
        if (typeof updateUser === 'function') updateUser(updatedUser);
        else localStorage.setItem('user', JSON.stringify(updatedUser));
      }
      toast.success(res.data?.message || 'Shop changed successfully!');
      setShowShopPicker(false);
      // Reload shop info for the new shop
      setShopInfo(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to change shop');
    } finally {
      setChangingShop(false);
    }
  };

  useEffect(() => {
    const loadShopInfo = async () => {
      if (!shopId) {
        setShopInfo(null);
        return;
      }
      try {
        const res = await shopAPI.getById(shopId);
        setShopInfo(res.data.data?.shop || res.data?.shop || res.data || null);
      } catch (err) {
        // Silently fail on network errors
        if (err.code !== 'ERR_NETWORK') {
          setShopInfo(null);
        }
      }
    };
    loadShopInfo();
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    const cleanup = onShopStatusUpdate((payload) => {
      if (payload?.isOpen === undefined) return;
      setShopInfo((prev) => prev ? { ...prev, isOpen: payload.isOpen } : prev);
      toast(`${payload.isOpen ? 'Shop is now open' : 'Shop is now closed'}`);
    });
    joinShopRoom(shopId);
    return cleanup;
  }, [shopId]);

  // ── Multi-document helpers ──────────────────────────────────────────────

  const updateDoc = (index, updates) => {
    setDocuments(prev => prev.map((d, i) => i === index ? { ...d, ...updates } : d));
  };

  const removeDoc = (index) => {
    setDocuments(prev => prev.filter((_, i) => i !== index));
    if (activeDocIndex === index) setActiveDocIndex(documents.length > 1 ? 0 : -1);
    else if (activeDocIndex > index) setActiveDocIndex(prev => prev - 1);
  };

  // Auto-upload file when selected
  
        const detectClientPages = async (file) => {
    const ext = file.name.toLowerCase();
    if (/\.(jpg|jpeg|png|webp|bmp)$/.test(ext)) return 1;
    
    // PDF detection
    if (/\.pdf$/.test(ext)) {
      try {
        const text = await file.slice(0, 500000).text();
        const matches = text.match(/\/Type\s*\/Page[^s]/g);
        if (matches && matches.length > 0) return matches.length;
        const countMatch = text.match(/\/Count\s+(\d+)/);
        if (countMatch && countMatch[1]) {
          const parsed = parseInt(countMatch[1], 10);
          if (parsed > 0 && parsed < 10000) return parsed;
        }
      } catch (e) {}
    }

    // PPT / PPTX presentation slide detection
    if (/\.(pptx|ppt|pptm|ppsx|odp)$/.test(ext)) {
      try {
        const text = await file.text();
        const slidesMatch = text.match(/<Slides>(\d+)<\/Slides>/i);
        if (slidesMatch && slidesMatch[1]) {
          const n = parseInt(slidesMatch[1], 10);
          if (n > 0 && n < 5000) return n;
        }
        const slideEntries = text.match(/ppt\/slides\/slide\d+\.xml/gi);
        if (slideEntries && slideEntries.length > 0) {
          return new Set(slideEntries.map(s => s.toLowerCase())).size;
        }
      } catch (e) {}
    }

    // DOCX Word: Rely on backend exact app.xml decompressed count
    if (/\.(docx|doc)$/.test(ext)) {
      try {
        const text = await file.text();
        const pagesMatch = text.match(/<Pages>(\d+)<\/Pages>/i);
        if (pagesMatch && pagesMatch[1]) {
          const n = parseInt(pagesMatch[1], 10);
          if (n > 0 && n < 5000) return n;
        }
      } catch (e) {}
      return 0; // Return 0 to let backend exact decompressed app.xml be the authoritative value
    }

    return 0;
  };

  const handleFileSelect = async (selectedFile) => {
    if (!selectedFile) return;

    setUploadStep('Uploading...');
    setUploadPct(0);

    try {
      const uploadRes = await uploadAPI.uploadFile(selectedFile, (pct) => {
        setUploadPct(pct);
        setUploadStep(pct < 100 ? `Uploading... ${pct}%` : 'Detecting pages...');
      });
      const doc = uploadRes.data.data || uploadRes.data;
      const clientPages = await detectClientPages(selectedFile);
      const detectedPages = (doc.detectedPages && doc.detectedPages > 0) ? doc.detectedPages : (clientPages > 0 ? clientPages : 0);
      const fileName = selectedFile?.name?.toLowerCase() || '';
      const isImage = /\.(jpg|jpeg|png)$/.test(fileName);
      const isWord  = /\.(doc|docx)$/.test(fileName);
      const isPPT   = /\.(ppt|pptx|pptm|ppsx|odp|key)$/.test(fileName);
      const manualRequired = Boolean(doc.manualCountRequired || ((isWord || isPPT) && detectedPages === 0));
      const effectivePages = isImage ? 1 : detectedPages;

      const newDoc = {
        id: Date.now(),
        file: selectedFile,
        fileData: {
          s3Url: doc.s3Url,
          s3Key: doc.s3Key,
          fileSize: doc.fileSize || selectedFile.size,
          detectedPages: effectivePages,
        },
        pageCount: effectivePages > 0 ? effectivePages : null,
        manualCountRequired: manualRequired,
        manualCountConfirmed: false,
        // NEW: Simple mode fields
        simpleMode: 'all-xerox', // Default to all xerox (most common)
        simpleCopies: 1, // Default 1 copy for all-color and all-xerox modes
        simpleSides: 'single', // Default sides for simple mode (all-color or all-xerox)
        colorPages: '',
        bwPages: '',
        colorSides: 'single', // Default 1-side for color
        bwSides: 'single', // Default 1-side for B&W
        colorCopies: 1, // Default 1 copy for color in customize mode
        bwCopies: 1, // Default 1 copy for B&W in customize mode
        configs: [{ id: Date.now(), rangeStart: 1, rangeEnd: effectivePages > 0 ? effectivePages : 1, copies: 1, colorMode: 'bw', sides: 'single', pagesPerSheet: 1 }],
        spiralBinding: false,
        blackbook: false,
        isPPT: isPPT,
        isImage: isImage,
        imageOptions: isImage ? {
          isImageFile: true,
          printType: doc.imageOptions?.printType || 'full_page',
          customWidthCm: doc.imageOptions?.customWidthCm || 10,
          customHeightCm: doc.imageOptions?.customHeightCm || 7.5,
          paperType: doc.imageOptions?.paperType || 'plain',
          drawCutLines: doc.imageOptions?.drawCutLines ?? true,
        } : null,
        presentationOptions: isPPT ? {
          isPresentationFile: true,
          printLayout: doc.presentationOptions?.recommendedLayout || 'handouts_4_horizontal',
          slidesPerPage: doc.presentationOptions?.recommendedSlidesPerPage || 4,
          orientation: doc.presentationOptions?.recommendedOrientation || 'landscape',
          frameSlides: doc.presentationOptions?.frameSlides ?? true,
          scaleToFitPaper: doc.presentationOptions?.scaleToFitPaper ?? true,
          highQuality: doc.presentationOptions?.highQuality ?? true,
        } : null,
      };

      setDocuments(prev => [...prev, newDoc]);
      setActiveDocIndex(documents.length); // select the new doc
      setUploadStep('');
      setUploadPct(0);

      if (effectivePages > 0) {
        toast.success(isImage ? `✅ Image added (1 page)` : `✅ ${effectivePages} pages detected — ${selectedFile.name}`);
      } else if (manualRequired) {
        toast(isPPT ? 'Please enter total slides for this PowerPoint file.' : 'Please enter total pages for DOC/DOCX file.');
      } else {
        // Remove the just-added doc since it failed
        setDocuments(prev => prev.filter(d => d.id !== newDoc.id));
        toast.error('Page count could not be detected. Upload a supported document.');
      }
    } catch (err) {
      setUploadStep('');
      setUploadPct(0);
      toast.error(err.response?.data?.message || 'Failed to upload file');
    }
  };

  const fetchOrders = useCallback(async () => {
    try {
      const res = await orderAPI.getMyOrders();
      setOrders(res.data.data?.orders || res.data.orders || []);
    } catch (err) {
      // Silently fail on network errors
      if (err.code !== 'ERR_NETWORK' && err.message !== 'Network Error') {
        // Only log actual API errors, not connection failures
      }
    }
  }, []);

  useEffect(() => {
    fetchOrders().finally(() => setLoading(false));
  }, [fetchOrders]);

  useEffect(() => {
    const cleanup = onOrderUpdate((data) => {
      setOrders((prev) =>
        prev.map((o) => o._id === data.orderId ? { ...o, status: data.status } : o)
      );
      setSelectedOrder((prev) =>
        prev?._id === data.orderId ? { ...prev, status: data.status } : prev
      );
      toast.info(`Order: ${statusLabels[data.status] || data.status}`);
    });
    return cleanup;
  }, []);

  useEffect(() => {
    const cleanup = onPaymentSuccess(() => {
      fetchOrders();
      toast.success('Payment confirmed! Order is in queue.');
    });
    return cleanup;
  }, [fetchOrders]);

  useEffect(() => {
    const cleanups = [
      onPrintStarted((data) => {
        setOrders((prev) => prev.map((o) => o._id === data.orderId ? { ...o, status: 'printing' } : o));
        setSelectedOrder((prev) => prev?._id === data.orderId ? { ...prev, status: 'printing' } : prev);
      }),
      onPrintCompleted((data) => {
        setOrders((prev) => prev.map((o) => o._id === data.orderId ? { ...o, status: 'ready' } : o));
        setSelectedOrder((prev) => prev?._id === data.orderId ? { ...prev, status: 'ready' } : prev);
        toast.success(`Order #${data.orderNumber} is ready for pickup!`);
      }),
      onPrintProgress((data) => {
        setOrders((prev) => prev.map((o) =>
          o._id === data.orderId ? { ...o, printProgress: data.progress } : o
        ));
      }),
      onPrintIssue((data) => {
        toast.error(data.message || 'Print issue reported');
      }),
    ];
    return () => cleanups.forEach((c) => c());
  }, []);

  useEffect(() => {
    orders.forEach((o) => {
      if (!['picked_up', 'cancelled', 'expired', 'rejected', 'refunded'].includes(o.status)) {
        joinOrderRoom(o._id);
      }
    });
  }, [orders]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (documents.length === 0) {
      toast.error('Please upload at least one document');
      return;
    }
    if (!SHOP_ID) {
      toast.error('Error: Shop not found. Please try logging in again.');
      return;
    }
    if (shopInfo && shopInfo.isOpen === false) {
      toast.error('This shop is currently closed.');
      return;
    }

    setSubmitting(true);
    setUploadStep('');

    try {
      // Convert simple mode to configs before validation
      for (let [di, doc] of documents.entries()) {
        if (doc.simpleMode === 'customize') {
          const colorResult = parsePageRange(doc.colorPages, doc.pageCount);
          const bwResult = parsePageRange(doc.bwPages, doc.pageCount);
          const colorPageNums = colorResult.pages;
          const bwPageNums = bwResult.pages;
          
          // Warn user about invalid page numbers that were filtered out
          const allInvalid = [...colorResult.invalid, ...bwResult.invalid];
          if (allInvalid.length > 0) {
            toast.warning(
              `⚠️ Ignored page(s) ${allInvalid.join(', ')} in "${doc.file.name}" — exceeds ${doc.pageCount} pages`,
              { duration: 5000 }
            );
          }
          
          // Check for overlap
          const overlap = colorPageNums.filter(p => bwPageNums.includes(p));
          if (overlap.length > 0) {
            toast.error(`Pages ${overlap.join(', ')} are in both color and B&W ranges for "${doc.file.name}"`);
            setActiveDocIndex(di);
            setSubmitting(false);
            return;
          }
          
          // Convert to configs with sides and copies
          const newConfigs = [];
          if (colorPageNums.length > 0) {
            // Group consecutive pages
            let rangeStart = colorPageNums[0];
            let rangeEnd = colorPageNums[0];
            
            for (let i = 1; i <= colorPageNums.length; i++) {
              if (i < colorPageNums.length && colorPageNums[i] === rangeEnd + 1) {
                rangeEnd = colorPageNums[i];
              } else {
                newConfigs.push({
                  id: Date.now() + Math.random(),
                  rangeStart,
                  rangeEnd,
                  copies: doc.colorCopies || 1,
                  colorMode: 'color',
                  sides: doc.colorSides || 'single',
                  pagesPerSheet: 1
                });
                if (i < colorPageNums.length) {
                  rangeStart = colorPageNums[i];
                  rangeEnd = colorPageNums[i];
                }
              }
            }
          }
          
          if (bwPageNums.length > 0) {
            let rangeStart = bwPageNums[0];
            let rangeEnd = bwPageNums[0];
            
            for (let i = 1; i <= bwPageNums.length; i++) {
              if (i < bwPageNums.length && bwPageNums[i] === rangeEnd + 1) {
                rangeEnd = bwPageNums[i];
              } else {
                newConfigs.push({
                  id: Date.now() + Math.random(),
                  rangeStart,
                  rangeEnd,
                  copies: doc.bwCopies || 1,
                  colorMode: 'bw',
                  sides: doc.bwSides || 'single',
                  pagesPerSheet: 1
                });
                if (i < bwPageNums.length) {
                  rangeStart = bwPageNums[i];
                  rangeEnd = bwPageNums[i];
                }
              }
            }
          }
          
          if (newConfigs.length === 0) {
            toast.error(`Please specify at least one page range for "${doc.file.name}"`);
            setActiveDocIndex(di);
            setSubmitting(false);
            return;
          }
          
          // Update document configs
          updateDoc(di, { configs: newConfigs });
          doc.configs = newConfigs; // Update local reference for validation
        }
      }

      // Validate all documents
      for (let [di, doc] of documents.entries()) {
        if (doc.manualCountRequired && !doc.manualCountConfirmed) {
          toast.error(`Please confirm page count for "${doc.file.name}"`);
          setActiveDocIndex(di);
          setSubmitting(false);
          return;
        }
        if (!doc.pageCount || doc.pageCount <= 0) {
          toast.error(`Page count missing for "${doc.file.name}"`);
          setActiveDocIndex(di);
          setSubmitting(false);
          return;
        }
        for (let [ci, config] of doc.configs.entries()) {
          // Ensure values are numbers
          const rangeStart = Number(config.rangeStart);
          const rangeEnd = Number(config.rangeEnd);
          const copies = Number(config.copies);
          
          if (config.rangeStart === '' || config.rangeEnd === '' || config.copies === '') {
            toast.error(`Missing fields in "${doc.file.name}" range ${ci + 1}`);
            setActiveDocIndex(di);
            setSubmitting(false);
            return;
          }
          if (rangeStart < 1 || rangeEnd > doc.pageCount || rangeStart > rangeEnd) {
            toast.error(`Invalid page range in "${doc.file.name}": ${rangeStart}-${rangeEnd}`);
            setActiveDocIndex(di);
            setSubmitting(false);
            return;
          }
          if (copies < 1 || copies > 100) {
            toast.error(`Copies must be 1-100 in "${doc.file.name}" range ${ci + 1}`);
            setActiveDocIndex(di);
            setSubmitting(false);
            return;
          }
        }
      }

      setUploadStep('Creating order...');

      // Build documents array for API
      const docsPayload = documents.map(doc => ({
        originalName: doc.file.name,
        s3Url: doc.fileData.s3Url,
        s3Key: doc.fileData.s3Key,
        fileSize: doc.fileData.fileSize,
        detectedPages: doc.pageCount,
        printingOptions: { paperSize: 'A4', orientation: 'auto' },
        presentationOptions: doc.isPPT ? doc.presentationOptions : undefined,
        imageOptions: doc.isImage ? doc.imageOptions : undefined,
        printingRanges: doc.configs.map(c => {
          // For simple modes (all-xerox / all-color), `simpleSides` is the
          // canonical source of truth for sides — the Sides dropdown writes to
          // both `simpleSides` and `configs[].sides`, but the initial config
          // created at upload time may be stale. Use `simpleSides` as the
          // authoritative override whenever the doc is in a simple mode.
          // Use ?? (nullish) not || (falsy) so that a valid 'single' value
          // is never skipped in favour of the fallback.
          const effectiveSides = (doc.simpleMode === 'all-xerox' || doc.simpleMode === 'all-color')
            ? (doc.simpleSides ?? c.sides ?? 'single')
            : (c.sides ?? 'single');
          return {
            rangeStart: Math.max(1, Math.min(parseInt(c.rangeStart) || 1, doc.pageCount)),
            rangeEnd: Math.max(1, Math.min(parseInt(c.rangeEnd) || doc.pageCount, doc.pageCount)),
            copies: Math.max(1, Math.min(parseInt(c.copies) || 1, 100)),
            colorMode: c.colorMode,
            sides: effectiveSides,
            pagesPerSheet: parseInt(c.pagesPerSheet) || 1,
          };
        }),
      }));

      const hasSpiral = documents.some(d => d.spiralBinding);
      const hasBlackbook = documents.some(d => d.blackbook);

      const idempotencyKey = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const orderRes = await orderAPI.create({
        shopId: shopId,
        documents: docsPayload,
        additionalServices: { spiralBinding: hasSpiral, blackbook: hasBlackbook },
      }, { headers: { 'Idempotency-Key': idempotencyKey } });

      const { order, razorpay } = orderRes.data.data;

      const resetForm = () => {
        setDocuments([]);
        setActiveDocIndex(-1);
        setUploadStep('');
      };

      const finishCheckout = () => {
        resetForm();
        setSubmitting(false);
        setUploadStep('');
      };

      if (!razorpay?.key || !razorpay?.orderId) {
        throw new Error('Payment gateway configuration missing. Contact support.');
      }

      if (typeof window.Razorpay !== 'function') {
        await new Promise((resolve, reject) => {
          const existing = document.querySelector('script[src*="checkout.razorpay.com"]');
          if (existing) { reject(new Error('Razorpay script loaded but not ready. Please refresh.')); return; }
          const s = document.createElement('script');
          s.src = 'https://checkout.razorpay.com/v1/checkout.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('Failed to load payment gateway.'));
          document.head.appendChild(s);
        });
      }

      if (typeof window.Razorpay !== 'function') {
        throw new Error('Payment gateway not available. Please refresh.');
      }

      setUploadStep('Opening payment...');

      if (import.meta.env.DEV && razorpay.orderId.startsWith('mock_order_')) {
        toast.info('Using Mock Payment Gateway for testing...', { duration: 2000 });
        setTimeout(async () => {
          try {
            await paymentAPI.verify({
              razorpayOrderId: razorpay.orderId,
              razorpayPaymentId: `mock_pay_${Date.now()}`,
              razorpaySignature: 'mock_signature',
              amount: razorpay.amount,
            });
            toast.success('Payment successful! Order placed. ✅');
            fetchOrders();
            setActiveTab('orders');
          } catch {
            toast.error('Mock Payment verification failed.');
          } finally {
            finishCheckout();
          }
        }, 1500);
        return;
      }

      const options = {
        key: razorpay.key,
        amount: razorpay.amount,
        currency: razorpay.currency || 'INR',
        name: 'Smart Xerox',
        description: `${documents.length} document(s) printing`,
        order_id: razorpay.orderId,
        handler: async (response) => {
          try {
            await paymentAPI.verify({
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
              amount: razorpay.amount,
            });
            toast.success('Payment successful! Order placed. ✅');
            fetchOrders();
            setActiveTab('orders');
          } catch {
            toast.error('Payment verification failed. Contact support — Order ID: ' + order._id);
          } finally {
            finishCheckout();
          }
        },
        modal: {
          ondismiss: () => {
            toast.info('Payment cancelled. Complete it anytime from My Orders → Pay Now.');
            finishCheckout();
          },
        },
        prefill: { name: user?.name, email: user?.email, contact: user?.phone },
        theme: { color: '#f97316' },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to place order';
      toast.error(msg);
      console.error('Order creation error:', err.response?.data || err.message);
      setSubmitting(false);
      setUploadStep('');
    }
  };

  // Calculate frontend cost estimate across all documents
      const estimatedCost = () => {
    let cost = 0;
    documents.forEach((doc) => {
      if (doc.simpleMode === 'customize') {
        // Real-time calculation for Customize Pages mode
        if (doc.colorPages && doc.colorPages.trim()) {
          const colorResult = parsePageRange(doc.colorPages, doc.pageCount || 9999);
          const colorCount = colorResult.pages.length;
          if (colorCount > 0) {
            const colorCopies = doc.colorCopies === '' || doc.colorCopies === undefined ? 1 : Math.max(1, Number(doc.colorCopies) || 1);
            const isDouble = doc.colorSides === 'double';
            const colorSheets = isDouble ? Math.ceil(colorCount / 2) : colorCount;
            const sideKey = isDouble ? 'doubleSided' : 'singleSided';
            const colorRate = shopInfo?.pricing?.color?.[sideKey] ?? shopInfo?.pricing?.colorPerSheet ?? (isDouble ? 15 : 10);
            cost += colorRate * colorSheets * colorCopies;
          }
        }

        if (doc.bwPages && doc.bwPages.trim()) {
          const bwResult = parsePageRange(doc.bwPages, doc.pageCount || 9999);
          const bwCount = bwResult.pages.length;
          if (bwCount > 0) {
            const bwCopies = doc.bwCopies === '' || doc.bwCopies === undefined ? 1 : Math.max(1, Number(doc.bwCopies) || 1);
            const isDouble = doc.bwSides === 'double';
            const bwSheets = isDouble ? Math.ceil(bwCount / 2) : bwCount;
            const sideKey = isDouble ? 'doubleSided' : 'singleSided';
            const bwRate = shopInfo?.pricing?.bw?.[sideKey] ?? shopInfo?.pricing?.bwPerSheet ?? (isDouble ? 3 : 2);
            cost += bwRate * bwSheets * bwCopies;
          }
        }
      } else {
        // Standard / All Pages mode
        const configs = doc.configs && doc.configs.length > 0 ? doc.configs : [{
          rangeStart: 1,
          rangeEnd: doc.pageCount || 1,
          copies: doc.simpleCopies || 1,
          colorMode: doc.simpleMode === 'all-color' ? 'color' : 'bw',
          sides: doc.simpleSides || 'single',
          pagesPerSheet: 1
        }];

        configs.forEach((cfg) => {
          const start = Number(cfg.rangeStart) || 1;
          const end = Number(cfg.rangeEnd) || doc.pageCount || 1;
          const pagesInRange = Math.max(1, end - start + 1);
          const pps = Number(cfg.pagesPerSheet) || 1;
          const physicalSidesNeeded = Math.ceil(pagesInRange / pps);

          const isDouble = cfg.sides === 'double';
          const effectiveSheets = isDouble ? Math.ceil(physicalSidesNeeded / 2) : physicalSidesNeeded;
          const copies = Number(cfg.copies) || 1;

          const colorMode = cfg.colorMode === 'color' ? 'color' : 'bw';
          const sideKey = isDouble ? 'doubleSided' : 'singleSided';

          const shopPricing = shopInfo?.pricing || {};
          const colorPricing = shopPricing[colorMode] || shopPricing['bw'] || {};
          const fallbackRate = colorMode === 'color' ? (isDouble ? 15 : 10) : (isDouble ? 3 : 2);
          const basePrice = colorPricing[sideKey] ?? fallbackRate;

          cost += basePrice * effectiveSheets * copies;
        });
      }

      if (doc.spiralBinding) cost += (shopInfo?.pricing?.bindingPerDocument || 30);
      if (doc.blackbook) cost += 50;
    });

    // Customer pays exact base total (no extra fees added on top)
    return cost.toFixed(2);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50/40 via-background to-amber-50/30">
      <Navbar />
      <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-6xl">
        {/* ── Hero Header ── */}
        <div className="mb-6 sm:mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="font-heading text-2xl sm:text-3xl font-bold bg-gradient-to-r from-gray-900 via-gray-800 to-orange-600 bg-clip-text text-transparent">Hello, {user?.name} 👋</h1>
              <p className="text-muted-foreground text-sm sm:text-base mt-0.5">Manage your printing orders</p>
            </div>
            {/* Shop Status — mobile-friendly */}
            <div className="bg-white/80 dark:bg-card/80 backdrop-blur-xl border border-white/60 dark:border-border/60 shadow-lg shadow-orange-500/5 rounded-2xl p-3 sm:p-4 flex items-center justify-between gap-3 sm:gap-5 w-full sm:w-auto sm:min-w-[320px]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-orange-100 to-amber-50 dark:from-orange-500/20 dark:to-amber-500/10 shrink-0">
                  <Store className="h-5 w-5 sm:h-6 sm:w-6 text-[#ff6a00]" />
                </div>
                <div className="flex flex-col min-w-0">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Selected Shop</p>
                  <p className="font-heading text-[13px] sm:text-[15px] font-bold text-foreground leading-tight truncate">
                    {shopInfo?.name || (SHOP_ID ? 'Loading...' : 'No shop linked')}
                  </p>
                  <div className="flex items-center mt-0.5">
                    {SHOP_ID ? (
                      shopInfo ? (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wider ${shopInfo.isOpen ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                          <span className={`mr-1 h-1.5 w-1.5 rounded-full ${shopInfo.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                          {shopInfo.isOpen ? 'OPEN NOW' : 'CLOSED'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold bg-secondary text-muted-foreground">
                          <Loader2 className="mr-1 h-2 w-2 animate-spin" /> CHECKING
                        </span>
                      )
                    ) : (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold bg-yellow-100 text-yellow-700">⚠️ NOT LINKED</span>
                    )}
                  </div>
                </div>
              </div>
              <button onClick={() => { setShowShopPicker(true); loadAllShops(); }}
                className="text-[#ff6a00] hover:text-[#e05d00] font-semibold text-xs sm:text-sm transition-colors whitespace-nowrap px-2 py-1.5 rounded-lg hover:bg-orange-50">
                Change
              </button>
            </div>
          </div>
        </div>

        {/* ── Modern Tabs ── */}
        <div className="mb-5 sm:mb-6 flex gap-2 bg-white/60 dark:bg-card/60 backdrop-blur-sm p-1.5 rounded-2xl border border-white/80 dark:border-border/40 w-fit">
          {[
            { key: 'orders', label: 'My Orders', icon: <Package className="h-4 w-4" />, count: orders.length },
            { key: 'new', label: 'New Order', icon: <Plus className="h-4 w-4" /> },
          ].map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-xl px-4 sm:px-5 py-2 sm:py-2.5 text-sm font-semibold transition-all ${
                activeTab === tab.key
                  ? 'sunrise-gradient text-white shadow-md shadow-orange-500/25'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/80'
              }`}>
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.key === 'orders' ? 'Orders' : 'New'}</span>
              {tab.count != null && tab.count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === tab.key ? 'bg-white/20' : 'bg-orange-100 text-orange-700'}`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── New Order Form — Multi-Document ──────────────────── */}
        {activeTab === 'new' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <h2 className="font-heading text-xl font-semibold mb-6">Place New Order</h2>
            <form onSubmit={handleSubmit}>
              <div className="flex flex-col lg:flex-row gap-6">
                {/* LEFT: Upload + Active Doc Config */}
                <div className="flex-1 space-y-5 min-w-0">
                  {/* Upload Section */}
                  <div className="bg-white/80 dark:bg-card/80 backdrop-blur-xl border border-white/60 dark:border-border/40 rounded-2xl p-4 sm:p-5 shadow-sm">
                    <Label className="mb-2 block font-semibold text-sm">Upload Documents</Label>
                    <div className="border-2 border-dashed border-orange-200 dark:border-border rounded-xl p-5 sm:p-6 text-center hover:border-orange-400 hover:bg-orange-50/30 transition-all">
                      <input type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.pptm,.ppsx,.odp,.key,.jpg,.jpeg,.png" onChange={(e) => { handleFileSelect(e.target.files?.[0] || null); e.target.value = ''; }} className="hidden" id="file-upload" disabled={uploadStep !== ''} />
                      <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-100 to-amber-50 flex items-center justify-center mb-2">
                          <Upload className="h-6 w-6 text-orange-500" />
                        </div>
                        <p className="text-sm font-medium text-foreground">{uploadStep || 'Click to add a file'}</p>
                        {uploadStep && uploadPct > 0 && uploadPct < 100 && (
                          <div className="w-full max-w-xs mt-3"><div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden"><div className="h-full rounded-full bg-primary transition-all duration-200" style={{ width: `${uploadPct}%` }} /></div></div>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">PDF, DOC, DOCX, PPT, PPTX, JPG, PNG · Max 50MB · Multiple files</p>
                      </label>
                    </div>
                  </div>

                  
                  {/* ⚡ BATCH CONTROLS (When multiple files are uploaded) */}
                  {documents.length > 1 && (
                    <div className="bg-gradient-to-r from-orange-50 via-amber-50 to-orange-50 dark:from-orange-950/30 dark:via-amber-950/20 dark:to-orange-950/30 border border-orange-200 dark:border-orange-800/40 rounded-2xl p-3.5 shadow-sm">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-xs font-bold text-orange-900 dark:text-orange-200 flex items-center gap-1.5">
                          <span>⚡</span> Apply to All {documents.length} Files:
                        </span>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => applyOptionToAllDocs({ sides: 'double' })}
                            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-orange-500 text-white hover:bg-orange-600 transition-all shadow-sm hover:shadow active:scale-95 flex items-center gap-1.5"
                          >
                            📖 Make All 2-Side (Back-to-Back)
                          </button>
                          <button
                            type="button"
                            onClick={() => applyOptionToAllDocs({ sides: 'single' })}
                            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-white dark:bg-card border border-slate-200 text-slate-700 dark:text-slate-200 hover:bg-slate-100 transition-all shadow-sm active:scale-95 flex items-center gap-1.5"
                          >
                            📄 Make All 1-Side (Single)
                          </button>
                          <button
                            type="button"
                            onClick={() => applyOptionToAllDocs({ colorMode: 'bw' })}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-xl bg-white dark:bg-card border border-slate-200 text-slate-600 dark:text-slate-300 hover:bg-slate-100 transition-all shadow-sm active:scale-95"
                          >
                            🖤 All B&W
                          </button>
                          <button
                            type="button"
                            onClick={() => applyOptionToAllDocs({ colorMode: 'color' })}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-xl bg-white dark:bg-card border border-pink-200 text-pink-700 dark:text-pink-300 hover:bg-pink-50 transition-all shadow-sm active:scale-95"
                          >
                            🎨 All Color
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-2">
                        💡 Tip: You can click "Make All 2-Side", and still change any specific file to 1-Side individually below.
                      </p>
                    </div>
                  )}

                  {/* Files List - Show on mobile right after upload, on desktop show in right column */}
                  <div className="lg:hidden">
                    <div className="bg-white/80 dark:bg-card/80 backdrop-blur-xl border border-white/60 dark:border-border/40 rounded-2xl p-4 shadow-sm">
                      <h3 className="font-heading font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-3 flex items-center justify-between">
                        <span>📎 Files ({documents.length})</span>
                        {documents.length > 0 && <button type="button" onClick={() => { setDocuments([]); setActiveDocIndex(-1); }} className="text-xs text-red-500 hover:text-red-600 font-medium">Clear All</button>}
                      </h3>
                      {documents.length === 0 ? (
                        <div className="py-8 text-center text-muted-foreground">
                          <Upload className="mx-auto h-8 w-8 opacity-40 mb-2" />
                          <p className="text-sm">No files added yet</p>
                          <p className="text-xs mt-1">Upload from above</p>
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                          {documents.map((doc, di) => (
                            <div key={doc.id} onClick={() => setActiveDocIndex(di)}
                              className={`rounded-xl border p-3 cursor-pointer transition-all ${activeDocIndex === di ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/30 hover:bg-secondary/50'}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium truncate">{doc.file.name}</p>
                                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">{doc.pageCount || '?'} pg</span>
                                    {doc.configs.map((c, ci) => (
                                      <span key={ci} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${c.colorMode === 'color' ? 'bg-pink-100 text-pink-700' : 'bg-gray-100 text-gray-600'}`}>
                                        {c.colorMode === 'color' ? 'Color' : 'B&W'} ×{c.copies}{c.pagesPerSheet > 1 ? ` (${c.pagesPerSheet}PP)` : ''}
                                      </span>
                                    ))}
                                    {doc.spiralBinding && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">Spiral</span>}
                                    {doc.blackbook && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-white font-medium">BB</span>}
                                  </div>
                                </div>
                                <button type="button" onClick={(e) => { e.stopPropagation(); removeDoc(di); }} className="text-red-400 hover:text-red-600 p-1 shrink-0"><X className="h-3.5 w-3.5" /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {documents.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <label htmlFor="file-upload" className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-lg border border-dashed border-primary/40 text-primary text-sm font-medium cursor-pointer hover:bg-primary/5 transition-colors">
                            <Plus className="h-4 w-4" /> Add Another File
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Active Document Config */}
                  {activeDocIndex >= 0 && activeDocIndex < documents.length && (() => {
                    const doc = documents[activeDocIndex];
                    const di = activeDocIndex;
                    return (
                      <div className="glass-card p-5 space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="font-heading font-semibold text-primary flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            {doc.file.name.length > 30 ? doc.file.name.substring(0, 30) + '...' : doc.file.name}
                          </h3>
                          <button type="button" onClick={() => removeDoc(di)} className="text-red-500 hover:text-red-600 p-1"><Trash2 className="h-4 w-4" /></button>
                        </div>
                        <p className="text-xs text-muted-foreground">{doc.pageCount ? `${doc.pageCount} pages` : 'Unknown'} · {(doc.fileData.fileSize / 1024).toFixed(0)} KB</p>

                        {doc.manualCountRequired && (
                          <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800 space-y-3">
                            <p className="font-medium">Enter total pages for this file.</p>
                            <Input type="number" min={1} value={doc.pageCount ?? ''} onChange={(e) => { const p = Number(e.target.value) || 0; updateDoc(di, { pageCount: p > 0 ? p : null, manualCountConfirmed: false, configs: [{ id: Date.now(), rangeStart: 1, rangeEnd: p > 0 ? p : 1, copies: 1, colorMode: 'bw', sides: doc.simpleSides || 'single' }] }); }} className="text-sm" />
                            <div className="flex items-center gap-2">
                              <input id={`confirm-${di}`} type="checkbox" checked={doc.manualCountConfirmed} onChange={(e) => updateDoc(di, { manualCountConfirmed: e.target.checked })} className="h-4 w-4 rounded" />
                              <label htmlFor={`confirm-${di}`} className="text-sm text-yellow-900">I confirm this is correct.</label>
                            </div>
                          </div>
                        )}

                        {doc.pageCount && (
                          <>
                            {/* Show Quick Print Settings only for regular documents (PDFs, DOCs) - NOT for images or PPTs */}
                            {!doc.isImage && !doc.isPPT && (
                              <>
                                <div className="rounded-xl bg-blue-500/10 border border-blue-500/30 p-3">
                                  <p className="text-sm text-blue-700">📄 <strong>{doc.pageCount} pages</strong> — Quick Print Settings</p>
                                </div>
                                
                                {/* SIMPLIFIED QUICK PRINT SETTINGS */}
                                <div className="space-y-4 bg-white dark:bg-card rounded-xl p-4 border-2 border-orange-200">
                                  <h4 className="font-semibold text-sm text-orange-800">Quick Print Settings</h4>
                              
                              {/* Dropdown 1: Print Mode */}
                              <div>
                                <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">1. Select Print Mode</Label>
                                <select 
                                  value={doc.simpleMode || 'all-xerox'}
                                  onChange={(e) => {
                                    const mode = e.target.value;
                                    // All modes default to single-sided.
                                    // Duplex only when user explicitly selects '2-Side'.
                                    const defaultSides = 'single';
                                    let configs = [];
                                    if (mode === 'all-color') {
                                      configs = [{ id: Date.now(), rangeStart: 1, rangeEnd: doc.pageCount, copies: doc.simpleCopies || 1, colorMode: 'color', sides: defaultSides, pagesPerSheet: 1 }];
                                    } else if (mode === 'all-xerox') {
                                      configs = [{ id: Date.now(), rangeStart: 1, rangeEnd: doc.pageCount, copies: doc.simpleCopies || 1, colorMode: 'bw', sides: defaultSides, pagesPerSheet: 1 }];
                                    }
                                    // simpleSides is reset to the mode's default so the Sides
                                    // dropdown always shows the correct value after a mode switch.
                                    updateDoc(di, { simpleMode: mode, simpleSides: defaultSides, configs });
                                  }}
                                  className="w-full rounded-lg border-2 border-orange-300 px-4 py-2.5 text-sm font-medium focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none bg-white dark:bg-gray-800"
                                >
                                  <option value="all-color">🎨 All Pages in Color</option>
                                  <option value="all-xerox">📄 All Pages Black & White (Xerox)</option>
                                  <option value="customize">⚙️ Customize Pages</option>
                                </select>
                              </div>

                              {/* For All Color and All Xerox: Show Sides + Copies */}
                              {(doc.simpleMode === 'all-color' || doc.simpleMode === 'all-xerox') && (
                                <div className="p-3 bg-orange-50/50 dark:bg-orange-950/20 rounded-lg border border-orange-200">
                                  <div className="grid grid-cols-2 gap-3">
                                    <div>
                                      <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Sides</Label>
                                      <select
                                        value={doc.simpleSides ?? 'single'}
                                        onChange={(e) => {
                                          const sides = e.target.value;
                                          updateDoc(di, { 
                                            simpleSides: sides,
                                            configs: [{ 
                                              id: Date.now(), 
                                              rangeStart: 1, 
                                              rangeEnd: doc.pageCount, 
                                              copies: doc.simpleCopies || 1, 
                                              colorMode: doc.simpleMode === 'all-color' ? 'color' : 'bw', 
                                              sides, 
                                              pagesPerSheet: 1 
                                            }]
                                          });
                                        }}
                                        className="w-full rounded-lg border-2 border-orange-300 px-4 py-2 text-sm font-medium focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none bg-white dark:bg-gray-800"
                                      >
                                        <option value="single">1-Side</option>
                                        <option value="double">2-Side</option>
                                      </select>
                                      <p className="text-xs text-muted-foreground mt-1">Single or double-sided</p>
                                    </div>
                                    <div>
                                      <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Number of Copies</Label>
                                      <Input
                                        type="number"
                                        min={1}
                                        max={100}
                                        value={doc.simpleCopies ?? ''}
                                        onChange={(e) => {
                                          const raw = e.target.value;
                                          if (raw === '') {
                                            updateDoc(di, { simpleCopies: '' });
                                            return;
                                          }
                                          const copies = Math.min(parseInt(raw) || 1, 100);
                                          updateDoc(di, { 
                                            simpleCopies: copies,
                                            configs: [{ 
                                              id: Date.now(), 
                                              rangeStart: 1, 
                                              rangeEnd: doc.pageCount, 
                                              copies, 
                                              colorMode: doc.simpleMode === 'all-color' ? 'color' : 'bw', 
                                              sides: doc.simpleSides ?? 'single', 
                                              pagesPerSheet: 1 
                                            }]
                                          });
                                        }}
                                        onBlur={() => {
                                          if (!doc.simpleCopies || doc.simpleCopies === '') {
                                            const copies = 1;
                                            updateDoc(di, { 
                                              simpleCopies: copies,
                                              configs: [{ 
                                                id: Date.now(), 
                                                rangeStart: 1, 
                                                rangeEnd: doc.pageCount, 
                                                copies, 
                                                colorMode: doc.simpleMode === 'all-color' ? 'color' : 'bw', 
                                                sides: doc.simpleSides ?? 'single', 
                                                pagesPerSheet: 1 
                                              }]
                                            });
                                          }
                                        }}
                                        className="border-2 border-orange-300 focus:border-orange-500 text-sm"
                                      />
                                      <p className="text-xs text-muted-foreground mt-1">How many copies? (1-100)</p>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Customize Mode: Show page ranges + Sides + Copies for each */}
                              {doc.simpleMode === 'customize' && (
                                <>
                                  <div className="space-y-4 p-3 bg-orange-50/50 dark:bg-orange-950/20 rounded-lg border border-orange-200">
                                    <p className="text-xs text-orange-800 dark:text-orange-400 font-medium">Enter page numbers separated by commas</p>
                                    
                                    {/* Color Pages Section */}
                                    <div className="space-y-3 p-3 bg-white dark:bg-gray-800 rounded-lg border-2 border-blue-200">
                                      <h5 className="text-sm font-semibold text-blue-700">🎨 Color Pages</h5>
                                      
                                      <div>
                                        <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Page Numbers (e.g., 1,3,5-8)</Label>
                                        <Input
                                          type="text"
                                          placeholder="e.g., 1,3,5-8,12"
                                          value={doc.colorPages || ''}
                                          onChange={(e) => updateDoc(di, { colorPages: e.target.value })}
                                          className="border-2 border-orange-300 focus:border-orange-500 text-sm"
                                        />
                                          <p className="text-xs text-muted-foreground mt-1">Leave blank if no color pages</p>
                                          {(doc.colorPages || '').trim() && (() => {
                                            const result = parsePageRange(doc.colorPages, doc.pageCount);
                                            return result.invalid.length > 0 ? (
                                              <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-1">
                                                ⚠️ Ignored: {result.invalid.join(', ')} — exceeds {doc.pageCount} pages
                                              </p>
                                            ) : null;
                                          })()}
                                      </div>

                                      <div className="grid grid-cols-2 gap-3">
                                        <div>
                                          <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Sides</Label>
                                          <div className="flex gap-2">
                                            <button
                                              type="button"
                                              onClick={() => updateDoc(di, { colorSides: 'single' })}
                                              className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border-2 transition-all ${
                                                (doc.colorSides || 'single') === 'single' 
                                                  ? 'border-orange-500 bg-orange-100 text-orange-800' 
                                                  : 'border-gray-300 bg-white text-gray-700 hover:border-orange-300'
                                              }`}
                                            >
                                              1-Side
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => updateDoc(di, { colorSides: 'double' })}
                                              className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border-2 transition-all ${
                                                doc.colorSides === 'double' 
                                                  ? 'border-orange-500 bg-orange-100 text-orange-800' 
                                                  : 'border-gray-300 bg-white text-gray-700 hover:border-orange-300'
                                              }`}
                                            >
                                              2-Side
                                            </button>
                                          </div>
                                        </div>

                                        <div>
                                          <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Copies</Label>
                                          <Input
                                            type="number"
                                            min={1}
                                            max={100}
                                            value={doc.colorCopies ?? ''}
                                            onChange={(e) => {
                                              const raw = e.target.value;
                                              updateDoc(di, { colorCopies: raw === '' ? '' : Math.min(parseInt(raw) || 1, 100) });
                                            }}
                                            onBlur={() => {
                                              if (!doc.colorCopies || doc.colorCopies === '') updateDoc(di, { colorCopies: 1 });
                                            }}
                                            className="border-2 border-orange-300 focus:border-orange-500 text-sm"
                                          />
                                        </div>
                                      </div>
                                    </div>

                                    {/* Black & White Pages Section */}
                                    <div className="space-y-3 p-3 bg-white dark:bg-gray-800 rounded-lg border-2 border-gray-300">
                                      <h5 className="text-sm font-semibold text-gray-700">📄 Black & White Pages</h5>
                                      
                                      <div>
                                        <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Page Numbers (e.g., 2,4,9-15)</Label>
                                        <Input
                                          type="text"
                                          placeholder="e.g., 2,4,9-15"
                                          value={doc.bwPages || ''}
                                          onChange={(e) => updateDoc(di, { bwPages: e.target.value })}
                                          className="border-2 border-orange-300 focus:border-orange-500 text-sm"
                                        />
                                          <p className="text-xs text-muted-foreground mt-1">Leave blank if no B&W pages</p>
                                          {(doc.bwPages || '').trim() && (() => {
                                            const result = parsePageRange(doc.bwPages, doc.pageCount);
                                            return result.invalid.length > 0 ? (
                                              <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-1">
                                                ⚠️ Ignored: {result.invalid.join(', ')} — exceeds {doc.pageCount} pages
                                              </p>
                                            ) : null;
                                          })()}
                                      </div>

                                      <div className="grid grid-cols-2 gap-3">
                                        <div>
                                          <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Sides</Label>
                                          <div className="flex gap-2">
                                            <button
                                              type="button"
                                              onClick={() => updateDoc(di, { bwSides: 'single' })}
                                              className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border-2 transition-all ${
                                                (doc.bwSides || 'single') === 'single' 
                                                  ? 'border-orange-500 bg-orange-100 text-orange-800' 
                                                  : 'border-gray-300 bg-white text-gray-700 hover:border-orange-300'
                                              }`}
                                            >
                                              1-Side
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => updateDoc(di, { bwSides: 'double' })}
                                              className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border-2 transition-all ${
                                                doc.bwSides === 'double' 
                                                  ? 'border-orange-500 bg-orange-100 text-orange-800' 
                                                  : 'border-gray-300 bg-white text-gray-700 hover:border-orange-300'
                                              }`}
                                            >
                                              2-Side
                                            </button>
                                          </div>
                                        </div>

                                        <div>
                                          <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Copies</Label>
                                          <Input
                                            type="number"
                                            min={1}
                                            max={100}
                                            value={doc.bwCopies ?? ''}
                                            onChange={(e) => {
                                              const raw = e.target.value;
                                              updateDoc(di, { bwCopies: raw === '' ? '' : Math.min(parseInt(raw) || 1, 100) });
                                            }}
                                            onBlur={() => {
                                              if (!doc.bwCopies || doc.bwCopies === '') updateDoc(di, { bwCopies: 1 });
                                            }}
                                            className="border-2 border-orange-300 focus:border-orange-500 text-sm"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </>
                              )}

                              {/* Preview of selected mode */}
                              <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 rounded-lg p-3">
                                <p className="text-xs font-medium text-green-800 dark:text-green-400">
                                  ✓ {doc.simpleMode === 'all-color' ? `All ${doc.pageCount} pages × ${doc.simpleCopies || 1} ${(doc.simpleCopies || 1) > 1 ? 'copies' : 'copy'} in COLOR (${(doc.simpleSides ?? 'single') === 'double' ? '2-Side' : '1-Side'})` :
                                     doc.simpleMode === 'all-xerox' ? `All ${doc.pageCount} pages × ${doc.simpleCopies || 1} ${(doc.simpleCopies || 1) > 1 ? 'copies' : 'copy'} in BLACK & WHITE (${(doc.simpleSides ?? 'single') === 'double' ? '2-Side' : '1-Side'})` :
                                     'Custom page ranges selected'}
                                </p>
                              </div>
                            </div>
                              </>
                            )}

                            {/* Spiral Binding & Blackbook - Show for regular documents only (PDFs, DOCs) */}
                            {!doc.isImage && !doc.isPPT && (
                            <div className="grid grid-cols-2 gap-3 mt-3">
                              <label className="flex items-center gap-2 rounded-lg border border-border p-3 bg-secondary/20 cursor-pointer">
                                <input type="checkbox" checked={doc.spiralBinding} onChange={(e) => updateDoc(di, { spiralBinding: e.target.checked })} className="h-4 w-4 rounded" />
                                <span className="text-sm font-medium">Spiral <span className="text-muted-foreground">+₹30</span></span>
                              </label>
                              <label className="flex items-center gap-2 rounded-lg border border-border p-3 bg-secondary/20 cursor-pointer">
                                <input type="checkbox" checked={doc.blackbook} onChange={(e) => { updateDoc(di, { blackbook: e.target.checked }); if (e.target.checked && doc.pageCount) { updateDoc(di, { blackbook: true, configs: [{ id: Date.now(), rangeStart: 1, rangeEnd: doc.pageCount, copies: 1, colorMode: 'bw', sides: 'double', pagesPerSheet: 1 }] }); toast.info('Blackbook: all pages, double-sided.'); } }} className="h-4 w-4 rounded" />
                                <span className="text-sm font-medium">Blackbook <span className="text-muted-foreground">+₹50</span></span>
                              </label>
                            </div>
                            )}

                            {/* PowerPoint Print Settings - Show for PPT files only */}
                            {doc.isPPT && (
                              <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-4 space-y-3">
                                <h4 className="font-semibold text-orange-800 text-sm flex items-center justify-between">
                                  <span className="flex items-center gap-2">📊 PowerPoint Print Settings</span>
                                  <span className="text-xs font-normal bg-orange-100 text-orange-800 px-2.5 py-0.5 rounded-full font-semibold">
                                    {doc.pageCount || 0} Slides Total
                                  </span>
                                </h4>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  {/* 1. Print Layout */}
                                  <div>
                                    <Label className="text-xs font-semibold text-gray-700 mb-1 block">1. Print Layout</Label>
                                    <select 
                                      value={doc.presentationOptions?.printLayout || "handouts_4_horizontal"}
                                      onChange={(e) => {
                                        const layout = e.target.value;
                                        const sppMap = { "full_page_slides": 1, "handouts_2_horizontal": 2, "handouts_3": 3, "handouts_4_horizontal": 4, "handouts_6_horizontal": 6, "handouts_9_horizontal": 9 };
                                        const spp = sppMap[layout] || 1;
                                        const orient = (spp === 1) ? "landscape" : (spp === 2 ? "portrait" : "landscape");
                                        updateDoc(di, { 
                                          presentationOptions: { 
                                            ...doc.presentationOptions, 
                                            printLayout: layout,
                                            slidesPerPage: spp,
                                            orientation: orient
                                          } 
                                        });
                                      }}
                                      className="w-full rounded-lg border-2 border-orange-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none bg-white font-medium"
                                    >
                                      <option value="full_page_slides">Full Page Slides (1 per page)</option>
                                      <option value="handouts_2_horizontal">Handouts: 2 Slides</option>
                                      <option value="handouts_3">Handouts: 3 Slides</option>
                                      <option value="handouts_4_horizontal">Handouts: 4 Slides (Recommended)</option>
                                      <option value="handouts_6_horizontal">Handouts: 6 Slides</option>
                                      <option value="handouts_9_horizontal">Handouts: 9 Slides</option>
                                    </select>
                                  </div>

                                  {/* 2. SIDES: 1-Side (Single) vs 2-Side (Double / Back-to-Back) */}
                                  <div>
                                    <Label className="text-xs font-semibold text-gray-700 mb-1 block">2. Select Sides</Label>
                                    <select
                                      value={doc.simpleSides || "single"}
                                      onChange={(e) => {
                                        const s = e.target.value;
                                        updateDoc(di, {
                                          simpleSides: s,
                                          colorSides: s,
                                          bwSides: s,
                                          configs: doc.configs.map(c => ({ ...c, sides: s }))
                                        });
                                      }}
                                      className="w-full rounded-lg border-2 border-orange-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none bg-white font-semibold text-orange-950"
                                    >
                                      <option value="single">📄 1-Side (Single-Sided)</option>
                                      <option value="double">📖 2-Side (Back-to-Back)</option>
                                    </select>
                                  </div>

                                  {/* 3. Orientation */}
                                  <div>
                                    <Label className="text-xs font-semibold text-gray-700 mb-1 block">3. Orientation</Label>
                                    <select 
                                      value={doc.presentationOptions?.orientation || "landscape"}
                                      onChange={(e) => updateDoc(di, { presentationOptions: { ...doc.presentationOptions, orientation: e.target.value } })}
                                      className="w-full rounded-lg border-2 border-orange-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none bg-white font-medium"
                                    >
                                      <option value="landscape">Landscape (Horizontal)</option>
                                      <option value="portrait">Portrait (Vertical)</option>
                                    </select>
                                  </div>
                                </div>

                                {/* Color Mode & Copies */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                  <div>
                                    <Label className="text-xs font-semibold text-gray-700 mb-1 block">Color Mode</Label>
                                    <select
                                      value={doc.simpleMode || "all-xerox"}
                                      onChange={(e) => {
                                        const mode = e.target.value;
                                        const colorMode = mode === "all-color" ? "color" : "bw";
                                        updateDoc(di, {
                                          simpleMode: mode,
                                          configs: doc.configs.map(c => ({ ...c, colorMode }))
                                        });
                                      }}
                                      className="w-full rounded-lg border-2 border-orange-200 px-3 py-2 text-sm focus:border-orange-500 outline-none bg-white font-medium"
                                    >
                                      <option value="all-xerox">🖤 Black & White (B&W Xerox)</option>
                                      <option value="all-color">🎨 Full Color Print</option>
                                    </select>
                                  </div>
                                  <div>
                                    <Label className="text-xs font-semibold text-gray-700 mb-1 block">Number of Copies</Label>
                                    <Input
                                      type="number"
                                      min={1}
                                      max={100}
                                      value={doc.simpleCopies || 1}
                                      onChange={(e) => {
                                        const copies = Math.max(1, parseInt(e.target.value) || 1);
                                        updateDoc(di, {
                                          simpleCopies: copies,
                                          configs: doc.configs.map(c => ({ ...c, copies }))
                                        });
                                      }}
                                      className="text-sm bg-white"
                                    />
                                  </div>
                                </div>

                                <div className="flex gap-4 mt-2">
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={doc.presentationOptions?.frameSlides} onChange={(e) => updateDoc(di, { presentationOptions: { ...doc.presentationOptions, frameSlides: e.target.checked } })} className="h-4 w-4 rounded text-orange-600 focus:ring-orange-500" />
                                    <span className="text-xs font-medium text-orange-900">Frame Slides (Border around each slide)</span>
                                  </label>
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={doc.presentationOptions?.scaleToFitPaper} onChange={(e) => updateDoc(di, { presentationOptions: { ...doc.presentationOptions, scaleToFitPaper: e.target.checked } })} className="h-4 w-4 rounded text-orange-600 focus:ring-orange-500" />
                                    <span className="text-xs font-medium text-orange-900">Scale to Fit Paper</span>
                                  </label>
                                </div>
                              </div>
                            )}

                            {doc.isImage && doc.imageOptions && (
                              <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-4 space-y-3">
                                <h4 className="font-semibold text-orange-800 text-sm flex items-center gap-2">
                                  🖼️ Image & Photo Layout Settings
                                </h4>
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <Label className="text-xs">Print Size Preset</Label>
                                    <select 
                                      value={doc.imageOptions.printType || 'full_page'}
                                      onChange={(e) => {
                                        const type = e.target.value;
                                        let w = doc.imageOptions.customWidthCm;
                                        let h = doc.imageOptions.customHeightCm;
                                        if (type === 'passport_grid') {
                                          w = 3.5;
                                          h = 4.5;
                                        } else if (type === 'stamp_grid') {
                                          w = 1.5;
                                          h = 2.0;
                                        } else if (type === 'full_page') {
                                          w = 21.0;
                                          h = 29.7;
                                        }
                                        updateDoc(di, {
                                          imageOptions: {
                                            ...doc.imageOptions,
                                            printType: type,
                                            customWidthCm: w,
                                            customHeightCm: h
                                          }
                                        });
                                      }}
                                      className="w-full mt-1 rounded-lg border-2 border-orange-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none bg-white dark:bg-gray-800"
                                    >
                                      <option value="full_page">Full Page (1 Photo)</option>
                                      <option value="passport_grid">Passport Size Grid (3.5 × 4.5 cm)</option>
                                      <option value="stamp_grid">Stamp Size Grid (1.5 × 2.0 cm)</option>
                                      <option value="custom_size">Custom Size...</option>
                                    </select>
                                  </div>
                                  <div>
                                    <Label className="text-xs">Paper Type</Label>
                                    <select 
                                      value={doc.imageOptions.paperType || 'plain'}
                                      onChange={(e) => updateDoc(di, { imageOptions: { ...doc.imageOptions, paperType: e.target.value } })}
                                      className="w-full mt-1 rounded-lg border-2 border-orange-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none bg-white dark:bg-gray-800"
                                    >
                                      <option value="plain">Plain Paper (Normal)</option>
                                      <option value="glossy">Glossy Photo Paper (+₹{shopInfo?.pricing?.glossyPaperPerSheet ?? 15})</option>
                                    </select>
                                  </div>
                                </div>

                                {doc.imageOptions.printType === 'custom_size' && (
                                  <div className="grid grid-cols-2 gap-3 pt-1">
                                    <div>
                                      <Label className="text-xs">Custom Width (cm)</Label>
                                      <Input 
                                        type="number" 
                                        min={1} 
                                        max={30} 
                                        step={0.1}
                                        value={doc.imageOptions.customWidthCm}
                                        onChange={(e) => {
                                          const w = parseFloat(e.target.value) || 0;
                                          updateDoc(di, { imageOptions: { ...doc.imageOptions, customWidthCm: w } });
                                        }}
                                        className="mt-1 text-sm border-2 border-orange-200" 
                                      />
                                    </div>
                                    <div>
                                      <Label className="text-xs">Custom Height (cm)</Label>
                                      <Input 
                                        type="number" 
                                        min={1} 
                                        max={40} 
                                        step={0.1}
                                        value={doc.imageOptions.customHeightCm}
                                        onChange={(e) => {
                                          const h = parseFloat(e.target.value) || 0;
                                          updateDoc(di, { imageOptions: { ...doc.imageOptions, customHeightCm: h } });
                                        }}
                                        className="mt-1 text-sm border-2 border-orange-200" 
                                      />
                                    </div>
                                  </div>
                                )}

                                <div className="flex gap-4 mt-2">
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input 
                                      type="checkbox" 
                                      checked={doc.imageOptions.drawCutLines} 
                                      onChange={(e) => updateDoc(di, { imageOptions: { ...doc.imageOptions, drawCutLines: e.target.checked } })} 
                                      className="h-4 w-4 rounded text-orange-600 focus:ring-orange-500" 
                                    />
                                    <span className="text-xs font-medium text-orange-900">Draw Border / Cut Lines</span>
                                  </label>
                                </div>
                              </div>
                            )}

                            {/* OLD RANGE UI COMPLETELY REMOVED - Now using Quick Print Settings above */}
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {documents.length > 0 && activeDocIndex === -1 && (
                    <div className="bg-white/80 dark:bg-card/80 backdrop-blur-xl border border-white/60 dark:border-border/40 rounded-2xl p-8 text-center text-muted-foreground">
                      <FileText className="mx-auto h-10 w-10 mb-3 opacity-50" />
                      <p className="font-medium">Click a file on the right to configure it</p>
                    </div>
                  )}

                  {/* Cost + Submit */}
                  <div className="glass-card p-5 space-y-4">
                    <div className="rounded-xl bg-secondary/50 border border-border px-4 py-3 text-sm flex items-center justify-between">
                      <span className="text-muted-foreground font-medium">📍 {shopInfo?.name || (SHOP_ID ? 'Loading...' : '⚠️ No shop')}</span>
                      {SHOP_ID && shopInfo && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${shopInfo.isOpen ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{shopInfo.isOpen ? '🟢 Open' : '🔴 Closed'}</span>}
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-secondary p-4">
                      <span className="font-medium">Total ({documents.length} file{documents.length !== 1 ? 's' : ''})</span>
                      <span className="font-heading text-xl font-bold text-primary">₹{estimatedCost()}</span>
                    </div>
                    <Button type="submit" className="w-full sunrise-gradient text-primary-foreground sunrise-shadow-sm" disabled={submitting || !SHOP_ID || shopInfo?.isOpen === false || documents.length === 0}>
                      {!SHOP_ID ? '⚠️ Shop Not Found' : shopInfo?.isOpen === false ? '🔴 Shop Closed' : documents.length === 0 ? 'Upload files to continue' : submitting ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{uploadStep || 'Processing...'}</span> : `Place Order & Pay · ₹${estimatedCost()}`}
                    </Button>
                  </div>
                </div>

                {/* RIGHT: Files Summary Panel - Hidden on mobile, shown on desktop */}
                <div className="hidden lg:block w-full lg:w-80 shrink-0 space-y-4">
                  {/* Files List */}
                  <div className="bg-white/80 dark:bg-card/80 backdrop-blur-xl border border-white/60 dark:border-border/40 rounded-2xl p-4 shadow-sm lg:sticky lg:top-4">
                    <h3 className="font-heading font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-3 flex items-center justify-between">
                      <span>📎 Files ({documents.length})</span>
                      {documents.length > 0 && <button type="button" onClick={() => { setDocuments([]); setActiveDocIndex(-1); }} className="text-xs text-red-500 hover:text-red-600 font-medium">Clear All</button>}
                    </h3>
                    {documents.length === 0 ? (
                      <div className="py-8 text-center text-muted-foreground">
                        <Upload className="mx-auto h-8 w-8 opacity-40 mb-2" />
                        <p className="text-sm">No files added yet</p>
                        <p className="text-xs mt-1">Upload from the left</p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                        {documents.map((doc, di) => (
                          <div key={doc.id} onClick={() => setActiveDocIndex(di)}
                            className={`rounded-xl border p-3 cursor-pointer transition-all ${activeDocIndex === di ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/30 hover:bg-secondary/50'}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">{doc.file.name}</p>
                                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">{doc.pageCount || '?'} pg</span>
                                  {doc.configs.map((c, ci) => (
                                    <span key={ci} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${c.colorMode === 'color' ? 'bg-pink-100 text-pink-700' : 'bg-gray-100 text-gray-600'}`}>
                                      {c.colorMode === 'color' ? 'Color' : 'B&W'} ×{c.copies}{c.pagesPerSheet > 1 ? ` (${c.pagesPerSheet}PP)` : ''}
                                    </span>
                                  ))}
                                  {doc.spiralBinding && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">Spiral</span>}
                                  {doc.blackbook && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-white font-medium">BB</span>}
                                </div>
                              </div>
                              <button type="button" onClick={(e) => { e.stopPropagation(); removeDoc(di); }} className="text-red-400 hover:text-red-600 p-1 shrink-0"><X className="h-3.5 w-3.5" /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {documents.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <label htmlFor="file-upload" className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-lg border border-dashed border-primary/40 text-primary text-sm font-medium cursor-pointer hover:bg-primary/5 transition-colors">
                          <Plus className="h-4 w-4" /> Add Another File
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Preview Section - Shows when a document is selected */}
                  {activeDocIndex >= 0 && activeDocIndex < documents.length && (() => {
                    const doc = documents[activeDocIndex];
                    const config = doc.configs[0]; // Show preview for first config
                    if (!config) return null;

                    const activePagesPerSheet = doc.isPPT
                      ? (doc.presentationOptions?.slidesPerPage || 1)
                      : (config.pagesPerSheet || 1);

                    const activeOrientation = doc.isPPT
                      ? (doc.presentationOptions?.orientation || 'landscape')
                      : 'portrait';

                    const isPDF = (doc.file && doc.file.type === 'application/pdf') ||
                                  (doc.fileData?.s3Url && doc.fileData.s3Url.toLowerCase().includes('.pdf')) ||
                                  (doc.file?.name && doc.file.name.toLowerCase().endsWith('.pdf'));
                    const pdfFile = doc.file || doc.fileData?.s3Url;

                    return (
                      <div className="bg-white/80 dark:bg-card/80 backdrop-blur-xl border border-white/60 dark:border-border/40 rounded-2xl p-4 shadow-sm">
                        <h3 className="font-heading font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-3">
                          👁️ Preview
                        </h3>
                        {isPDF && pdfFile ? (
                          <RealPDFPreview
                            file={pdfFile}
                            pagesPerSheet={activePagesPerSheet}
                            rangeStart={config.rangeStart || 1}
                            rangeEnd={config.rangeEnd || doc.pageCount}
                            orientation={activeOrientation}
                          />
                        ) : (
                          <PagesPerSheetPreview 
                            pagesPerSheet={activePagesPerSheet} 
                            orientation={activeOrientation}
                            isImage={doc.isImage}
                            imageOptions={doc.imageOptions}
                          />
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </form>
          </motion.div>
        )}



        {/* ── Orders List ────────────────────────────────────────── */}
        {activeTab === 'orders' && (
          <div className="space-y-3 sm:space-y-4">
            {loading ? (
              <div className="text-center py-16">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-orange-500 mb-3" />
                <p className="text-muted-foreground text-sm">Loading your orders...</p>
              </div>
            ) : orders.length === 0 ? (
              <div className="text-center py-16 bg-white/60 dark:bg-card/60 backdrop-blur-sm rounded-3xl border border-white/80 dark:border-border/40">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-orange-100 to-amber-50 flex items-center justify-center">
                  <Package className="h-8 w-8 text-orange-500" />
                </div>
                <p className="text-muted-foreground font-medium">No orders yet</p>
                <p className="text-muted-foreground/60 text-sm mt-1">Upload a document to get started</p>
                <Button className="mt-5 sunrise-gradient text-white shadow-lg shadow-orange-500/25" onClick={() => setActiveTab('new')}>
                  <Plus className="h-4 w-4 mr-2" /> Place Your First Order
                </Button>
              </div>
            ) : (
              orders.map((order, i) => {
                const isPending   = order.status === 'pending_payment';
                const isTerminal  = ['cancelled', 'rejected', 'expired'].includes(order.status);
                const currentIdx  = STATUS_STEPS.indexOf(order.status);
                const showStepper = !isPending && !isTerminal;

                return (
                  <motion.div
                    key={order._id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="bg-white/80 dark:bg-card/80 backdrop-blur-xl border border-white/60 dark:border-border/40 rounded-2xl p-4 sm:p-5 cursor-pointer hover:shadow-lg hover:shadow-orange-500/8 transition-all duration-300 group"
                    onClick={() => { setSelectedOrder(order); joinOrderRoom(order._id); }}
                  >
                    {/* Header */}
                    <div className="flex items-start sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-xl bg-gradient-to-br from-orange-100 to-amber-50 shrink-0 group-hover:from-orange-200 group-hover:to-amber-100 transition-colors">
                          <FileText className="h-5 w-5 text-orange-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm sm:text-[15px] text-foreground">
                            Order {order.pickup?.pickupCode || order.orderNumber || order._id.slice(-6).toUpperCase()}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {order.documents?.[0]?.originalName || 'Document'}
                            {order.documents?.length > 1 ? ` +${order.documents.length - 1} more` : ''}
                            <span className="mx-1.5">·</span>
                            {new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap shrink-0">
                        <span className={`rounded-full px-2.5 sm:px-3 py-1 text-[10px] sm:text-xs font-semibold ${statusColors[order.status] || 'bg-muted text-muted-foreground'}`}>
                          {statusLabels[order.status] || order.status}
                        </span>
                        {order.pricing?.total != null && (
                          <span className="font-heading font-bold text-sm sm:text-base text-primary">₹{order.pricing.total}</span>
                        )}
                      </div>
                    </div>

                    {/* Pay Now — mobile full width */}
                    {isPending && (
                      <div className="mt-3">
                        <Button
                          size="sm"
                          className="w-full sm:w-auto sunrise-gradient text-white text-xs gap-1.5 shadow-md shadow-orange-500/20"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const res = await orderAPI.retryPayment(order._id);
                              const { razorpay } = res.data.data;
                              if (razorpay.orderId.startsWith('mock_order_')) {
                                toast.info('Using Mock Payment Gateway for testing...', { duration: 2000 });
                                setTimeout(async () => {
                                  try {
                                    await paymentAPI.verify({ razorpayOrderId: razorpay.orderId, razorpayPaymentId: `mock_pay_${Date.now()}`, razorpaySignature: 'mock_signature', amount: razorpay.amount });
                                    toast.success('Payment successful! ✅');
                                    fetchOrders();
                                  } catch { toast.error('Mock Payment verification failed.'); }
                                }, 1500);
                                return;
                              }
                              if (typeof window.Razorpay !== 'function') throw new Error('Payment gateway not available.');
                              const rzp = new window.Razorpay({
                                key: razorpay.key, amount: razorpay.amount, currency: razorpay.currency,
                                name: 'Smart Xerox', description: 'Document Printing', order_id: razorpay.orderId,
                                handler: async (response) => {
                                  try {
                                    await paymentAPI.verify({ razorpayOrderId: response.razorpay_order_id, razorpayPaymentId: response.razorpay_payment_id, razorpaySignature: response.razorpay_signature, amount: razorpay.amount });
                                    toast.success('Payment successful! ✅');
                                    fetchOrders();
                                  } catch { toast.error('Payment verification failed.'); }
                                },
                                modal: { ondismiss: () => toast.info('Payment cancelled.') },
                                prefill: { name: user?.name, email: user?.email, contact: user?.phone },
                                theme: { color: '#f97316' },
                              });
                              rzp.open();
                            } catch (err) {
                              toast.error(err.response?.data?.message || err.message || 'Could not open payment.');
                            }
                          }}
                        >
                          <CreditCard className="h-3.5 w-3.5" /> Complete Payment
                        </Button>
                      </div>
                    )}

                    {/* Progress stepper */}
                    {showStepper && (
                      <div className="mt-4 w-full">
                        <div className="flex w-full justify-between items-start">
                          {STATUS_STEPS.map((step, si) => {
                            const done = si <= currentIdx;
                            const isLast = si === STATUS_STEPS.length - 1;
                            const isFirst = si === 0;
                            return (
                              <div key={step} className="flex flex-col items-center flex-1">
                                <div className="flex items-center w-full">
                                  <div className={`h-[2px] flex-1 transition-colors ${isFirst ? 'bg-transparent' : done ? 'bg-orange-500' : 'bg-muted'}`} />
                                  <div className={`flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full text-[9px] sm:text-[10px] font-semibold shrink-0 transition-all ${done ? 'bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-sm shadow-orange-500/30' : 'bg-muted text-muted-foreground'}`}>
                                    {done ? <CheckCircle className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> : si + 1}
                                  </div>
                                  <div className={`h-[2px] flex-1 transition-colors ${isLast ? 'bg-transparent' : si < currentIdx ? 'bg-orange-500' : 'bg-muted'}`} />
                                </div>
                                <span className={`mt-1 text-[8px] sm:text-[10px] text-center leading-tight ${done ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
                                  {STEP_LABELS[step]}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Ready banner */}
                    {order.status === 'ready' && (
                      <div className="mt-3 rounded-xl bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200/60 px-3 py-2.5 text-xs text-emerald-800 flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />
                        <span><strong>Ready for pickup!</strong> Check your email for the OTP.</span>
                      </div>
                    )}
                  </motion.div>
                );
              })
            )}
          </div>
        )}

        {/* ── Order Detail Modal ─── */}
        {selectedOrder && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4" onClick={() => setSelectedOrder(null)}>
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white dark:bg-card rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 w-full sm:max-w-md max-h-[85vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Handle bar on mobile */}
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4 sm:hidden" />
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-heading text-lg font-bold">Order Details</h3>
                <button onClick={() => setSelectedOrder(null)} className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"><X className="h-5 w-5" /></button>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center py-2 border-b border-border/40">
                  <span className="text-muted-foreground">Order</span>
                  <span className="font-semibold">#{selectedOrder.orderNumber || selectedOrder._id.slice(-8).toUpperCase()}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/40">
                  <span className="text-muted-foreground">Status</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColors[selectedOrder.status] || ''}`}>
                    {statusLabels[selectedOrder.status] || selectedOrder.status}
                  </span>
                </div>
                {selectedOrder.documents?.map((doc, di) => (
                  <div key={di} className="py-2 border-b border-border/40">
                    <p className="font-medium text-foreground truncate">{doc.fileName || doc.originalName || `Document ${di + 1}`}</p>
                    <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                      {doc.copies && <span>×{doc.copies}</span>}
                      {doc.colorType && <span>{doc.colorType === 'color' ? '🌈 Color' : '⬛ B&W'}</span>}
                      {doc.paperSize && <span>{doc.paperSize}</span>}
                    </div>
                  </div>
                ))}
                <div className="flex justify-between items-center py-2 border-b border-border/40">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-heading font-bold text-lg text-primary">₹{selectedOrder.pricing?.total}</span>
                </div>
                {selectedOrder.shop && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">Shop</span>
                    <span className="font-medium">{selectedOrder.shop?.name}</span>
                  </div>
                )}
              </div>
              {selectedOrder.status === 'ready' && (
                <div className="mt-4 rounded-xl bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200/60 p-4 text-center">
                  <p className="text-sm text-emerald-700 font-semibold">✅ Ready for pickup!</p>
                  <p className="text-xs text-emerald-600 mt-1">Check your email for the OTP.</p>
                </div>
              )}
            </motion.div>
          </div>
        )}

        {/* ── Shop Picker Modal ────────────────────────────────────── */}
        <AnimatePresence>
          {showShopPicker && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4" onClick={() => setShowShopPicker(false)}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="bg-[#EBE9E4] dark:bg-card rounded-3xl p-6 sm:p-8 max-w-[500px] w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl relative"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-6">
                  <h3 className="text-[22px] font-bold text-foreground mb-1 font-heading">Select Printing Shop</h3>
                  <p className="text-[13px] text-muted-foreground mb-1">Choose where you want to pick up your prints</p>
                  <button onClick={() => setShowShopPicker(false)} className="absolute top-6 right-6 p-1.5 text-black hover:bg-black/5 hover:text-foreground rounded-full transition-colors">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="overflow-y-auto flex-1 space-y-3 pb-2 custom-scrollbar">
                  {shopsLoading ? (
                    <div className="text-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto text-[#ff6a00] mb-3" />
                      <p className="text-sm text-muted-foreground">Loading shops...</p>
                    </div>
                  ) : allShops.length === 0 ? (
                    <div className="text-center py-12">
                      <Store className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                      <p className="text-sm text-muted-foreground">No shops available near you.</p>
                    </div>
                  ) : (
                    allShops.map((shop) => {
                      const isCurrentShop = shopId && (String(shop._id) === shopId);
                      return (
                        <motion.button
                          key={shop._id}
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          onClick={() => !changingShop && handleChangeShop(shop._id)}
                          disabled={changingShop}
                          className={`w-full text-left rounded-2xl p-4 transition-all outline-none ${
                            isCurrentShop
                              ? 'border-[1.5px] border-[#ff6a00] shadow-[0_4px_14px_rgba(255,106,0,0.1)] bg-transparent'
                              : 'border-[1.5px] border-black/5 hover:border-black/10 hover:bg-white/30 dark:border-border bg-transparent'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3.5 min-w-0">
                              <div className={`flex h-[52px] w-[52px] items-center justify-center rounded-2xl shrink-0 ${
                                isCurrentShop ? 'bg-[#ff6a00]' : 'bg-black/5 dark:bg-secondary'
                              }`}>
                                <Store className={`h-6 w-6 ${isCurrentShop ? 'text-white' : 'text-muted-foreground'}`} />
                              </div>
                              <div className="min-w-0 flex flex-col justify-center text-left">
                                <p className="font-bold text-[15px] truncate text-foreground mb-0.5 text-left">
                                  {shop.name}
                                </p>
                                {shop.address && (
                                  <p className="text-[13px] text-muted-foreground truncate mb-1.5 text-left">
                                    {[shop.address.street, shop.address.city].filter(Boolean).join(', ')}
                                  </p>
                                )}
                                <div className="flex items-center gap-2">
                                  <span className={`inline-flex items-center justify-center rounded px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase ${
                                    shop.isOpen
                                      ? 'bg-white dark:bg-[#12a150]/20 text-[#12a150] dark:text-[#2dd46f]'
                                      : 'bg-white dark:bg-red-900/30 text-red-600 dark:text-red-400'
                                  }`}>
                                    {shop.isOpen ? 'OPEN' : 'CLOSED'}
                                  </span>
                                  <span className="text-[11px] font-medium text-muted-foreground flex items-center">
                                    ⭐ {shop.rating?.toFixed(1) || '0'} ({shop.totalRatings || 0})
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-col items-end gap-2 shrink-0">
                              {isCurrentShop && (
                                <div className="flex items-center gap-1.5 text-[#ff6a00] font-bold text-[11px] uppercase tracking-wider">
                                  <span>✓ SELECTED</span>
                                </div>
                              )}
                              <ChevronDown className={`h-5 w-5 -rotate-90 ${isCurrentShop ? 'text-[#ff6a00]' : 'text-muted-foreground/50'}`} />
                            </div>
                          </div>
                        </motion.button>
                      );
                    })
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-black/5 dark:border-border text-center">
                  <p className="text-[11px] text-muted-foreground/80">Can't find your shop? Please contact support or invite your local shopkeeper.</p>
                </div>

                {changingShop && (
                  <div className="absolute inset-0 bg-[#EBE9E4]/60 dark:bg-card/60 backdrop-blur-[1px] z-10 flex flex-col items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-[#ff6a00] mb-3" />
                    <p className="font-semibold text-sm">Switching shop...</p>
                  </div>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      </div>
      <Footer />
    </div>
  );
};

export default UserDashboard;