import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, X, Phone, Mail, Clock, FileText, AlertCircle, CheckCircle2, XCircle, Package, Banknote, User, BookOpen, Loader2, Search, Filter, ChevronLeft, ChevronRight, Eye, ShieldAlert, Layers, Info, Fingerprint, ImageOff, CreditCard, Globe, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { kitAPI } from "@/lib/kitApi";

const STATUS = {
  "Pending Verification": { dot: "bg-yellow-400", badge: "bg-yellow-50 text-yellow-700 border-yellow-200", label: "PENDING" },
  "Payment Verified":     { dot: "bg-blue-400",   badge: "bg-blue-50 text-blue-700 border-blue-200",       label: "VERIFIED" },
  "Accepted":             { dot: "bg-indigo-400",  badge: "bg-indigo-50 text-indigo-700 border-indigo-200", label: "ACCEPTED" },
  "Completed":            { dot: "bg-green-400",   badge: "bg-green-50 text-green-700 border-green-200",    label: "DONE" },
  "Rejected":             { dot: "bg-red-400",     badge: "bg-red-50 text-red-700 border-red-200",          label: "REJECTED" },
  "Suspicious":           { dot: "bg-orange-400",  badge: "bg-orange-50 text-orange-700 border-orange-200", label: "SUSPICIOUS" },
};

const TABS = [
  { key: "pending",  label: "Pending",  statuses: ["Pending Verification", "Payment Verified"], icon: AlertCircle },
  { key: "active",   label: "Active",   statuses: ["Accepted"],                                  icon: Package },
  { key: "suspicious", label: "Suspicious", statuses: ["Suspicious"],                            icon: AlertCircle },
  { key: "history",  label: "History",  statuses: ["Completed", "Rejected"],                     icon: CheckCircle2 },
];

function ScreenshotViewer({ url, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4" onClick={onClose}>
      <div className="relative max-w-md w-full" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-4 -right-4 h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white">
          <X className="h-4 w-4" />
        </button>
        <p className="text-white/60 text-xs text-center mb-2">Payment Screenshot — verify before approving</p>
        <img src={url} alt="Payment proof" className="w-full rounded-xl object-contain max-h-[75vh] border border-white/10" />
        <p className="text-white/40 text-xs text-center mt-2">Tap outside to close</p>
      </div>
    </div>
  );
}

function RejectModal({ order, onConfirm, onClose, busy }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-red-600 flex items-center gap-2"><XCircle className="h-4 w-4" /> Reject Order</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-sm mb-1"><strong>{order.name}</strong></p>
        <p className="text-xs text-slate-600 mb-4">{order.year} Year {order.department ? "· " + order.department : "· Common Kit"} · Rs.{order.totalAmount}</p>
        <div className="mb-4">
          <Label className="text-xs">Reason <span className="text-slate-500">(sent to user via email)</span></Label>
          <Input className="mt-1 text-sm" placeholder="e.g. Payment screenshot unclear" value={reason} onChange={e => setReason(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="flex-1 bg-red-600 hover:bg-red-700 text-white" disabled={busy} onClick={() => onConfirm(reason)}>
            {busy ? "Rejecting..." : "Confirm Reject"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function FraudDetailModal({ order, onClose }) {
  const ff = order.fraudFlags || {};
  const score = ff.fraudScore || 0;
  const details = ff.details || {};

  const flagChecks = [
    { key: "screenshotReused", label: "Duplicate Screenshot", desc: "Same payment screenshot was already used in another order", pts: 60, icon: ImageOff, tier: 1 },
    { key: "transactionIdDuplicate", label: "Duplicate Transaction ID", desc: "This transaction ID was already submitted with a different order", pts: 60, icon: Hash, tier: 1 },
    { key: "multipleOrdersShortTime", label: "Rapid-Fire Orders", desc: `${details.recentOrderCount || "Multiple"} orders placed within 30 minutes`, pts: 20, icon: Clock, tier: 1 },
    { key: "suspiciousImageMetadata", label: "Invalid File Metadata", desc: (details.metaIssues || []).join("; ") || "File too small, too large, or wrong type", pts: 30, icon: FileText, tier: 1 },
    { key: "txnIdMismatch", label: "Transaction ID Mismatch", desc: "TXN ID extracted from screenshot via OCR does not match submitted ID", pts: 70, icon: ShieldAlert, tier: 2 },
    { key: "amountMismatch", label: "Amount Mismatch", desc: details.amountCheck && typeof details.amountCheck === "object" ? `Screenshot shows ₹${details.amountCheck.screenshotAmount} but order is ₹${details.amountCheck.orderAmount}` : "Payment amount in screenshot differs from order amount", pts: 60, icon: Banknote, tier: 2 },
    { key: "wrongCurrency", label: "Wrong Currency", desc: `Non-INR currency detected: ${details.currency || "unknown"}`, pts: 60, icon: Globe, tier: 2 },
    { key: "upiIdMismatch", label: "UPI ID Mismatch", desc: "UPI ID in the screenshot does not match the shop's registered UPI", pts: 50, icon: CreditCard, tier: 2 },
    { key: "multipleTransactions", label: "Multiple Transactions", desc: `${details.distinctAmounts || "3+"} distinct payment amounts found in one screenshot`, pts: 40, icon: Layers, tier: 2 },
    { key: "amountWordsMismatch", label: "Amount Words Mismatch", desc: details.amountWordsCheck ? `Words say ₹${details.amountWordsCheck.words} but numbers show ₹${details.amountWordsCheck.numeric}` : "Amount written in words doesn't match the numeric amount", pts: 45, icon: FileText, tier: 2 },
    { key: "editedImage", label: "Edited with Software", desc: "Image was processed by editing software (e.g. Photoshop, GIMP)", pts: 70, icon: Fingerprint, tier: 3 },
    { key: "exifModified", label: "EXIF Timestamp Modified", desc: "Image timestamps were altered after the original capture", pts: 50, icon: Clock, tier: 3 },
    { key: "oldScreenshot", label: "Old Screenshot", desc: `Screenshot is ${details.exif?.ageHours || "48+"}h old — expected a recent payment`, pts: 30, icon: Clock, tier: 3 },
    { key: "blurredAreas", label: "Severely Blurred", desc: `${details.blurPercent || ">50%"} of pixels are blurred — possibly intentional obfuscation`, pts: 35, icon: ImageOff, tier: 3 },
  ];

  const triggered = flagChecks.filter(f => ff[f.key]);
  const passed = flagChecks.filter(f => !ff[f.key]);
  const scorePercent = Math.min(100, (score / 200) * 100);
  const tierLabels = { 1: "Database Check", 2: "OCR Analysis", 3: "Image Integrity" };
  const tierColors = { 1: "bg-purple-100 text-purple-700", 2: "bg-blue-100 text-blue-700", 3: "bg-teal-100 text-teal-700" };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200 my-8" onClick={e => e.stopPropagation()}>

        {/* Header with Score */}
        <div className="bg-gradient-to-br from-slate-900 via-red-900/90 to-orange-900/80 p-5 rounded-t-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
                <ShieldAlert className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">Fraud Analysis Report</h3>
                <p className="text-white/60 text-xs">{order.name} · ₹{order.totalAmount} · #{order._id?.slice(-8).toUpperCase()}</p>
              </div>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Score Gauge */}
          <div className="bg-white/10 backdrop-blur rounded-xl p-4">
            <div className="flex items-end justify-between mb-2">
              <span className="text-white/70 text-sm font-medium">Risk Score</span>
              <div className="text-right">
                <span className={`font-black text-3xl ${score >= 100 ? "text-red-400" : score >= 60 ? "text-orange-400" : score > 0 ? "text-yellow-400" : "text-green-400"}`}>{score}</span>
                <span className="text-white/40 text-xs block">{score >= 100 ? "HIGH RISK" : score >= 60 ? "SUSPICIOUS" : score > 0 ? "LOW RISK" : "CLEAN"}</span>
              </div>
            </div>
            <div className="h-2.5 bg-white/10 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-700 ease-out ${score >= 100 ? "bg-gradient-to-r from-red-400 to-red-500" : score >= 60 ? "bg-gradient-to-r from-orange-400 to-red-400" : score > 0 ? "bg-gradient-to-r from-yellow-400 to-orange-400" : "bg-green-400"}`}
                style={{ width: `${scorePercent}%` }} />
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] text-white/40 font-medium">
              <span>0 Clean</span>
              <span className="border-l border-white/20 pl-2">60 Threshold</span>
              <span>200+</span>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 max-h-[55vh] overflow-y-auto">

          {/* Reason Summary */}
          {ff.flagReason && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3.5">
              <p className="text-xs font-bold text-red-700 mb-1.5 flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" /> Why was this flagged?
              </p>
              <p className="text-sm text-red-800 leading-relaxed">{ff.flagReason}</p>
            </div>
          )}

          {/* Triggered Flags */}
          {triggered.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-red-600 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <XCircle className="h-3.5 w-3.5" /> Failed Checks ({triggered.length})
              </h4>
              <div className="space-y-2">
                {triggered.map(f => {
                  const IconComp = f.icon;
                  return (
                    <div key={f.key} className="flex items-start gap-3 bg-gradient-to-r from-red-50 to-orange-50/50 border border-red-100 rounded-xl p-3 hover:shadow-md transition-shadow">
                      <div className="h-9 w-9 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                        <IconComp className="h-4 w-4 text-red-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold text-red-900">{f.label}</p>
                          <span className="text-[11px] font-black text-red-600 bg-red-100 px-2 py-0.5 rounded-md flex-shrink-0">+{f.pts}</span>
                        </div>
                        <p className="text-xs text-red-700/80 mt-0.5 leading-relaxed">{f.desc}</p>
                        <span className={`inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${tierColors[f.tier]}`}>
                          Tier {f.tier} · {tierLabels[f.tier]}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Analysis Details */}
          {(details.ocrReliable !== undefined || details.exif || details.blurPercent) && (
            <div>
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-blue-500" /> Technical Details
              </h4>
              <div className="bg-slate-50 rounded-xl p-3.5 grid grid-cols-2 gap-2.5">
                {details.ocrReliable !== undefined && (
                  <div className="bg-white rounded-lg p-2.5 border border-slate-100">
                    <p className="text-[10px] text-slate-500 font-medium uppercase">OCR Quality</p>
                    <p className={`text-sm font-bold ${details.ocrReliable ? "text-green-600" : "text-yellow-600"}`}>
                      {details.ocrReliable ? "✓ Reliable" : "⚠ Low Quality"}
                    </p>
                  </div>
                )}
                {details.txnIdMatch && (
                  <div className="bg-white rounded-lg p-2.5 border border-slate-100">
                    <p className="text-[10px] text-slate-500 font-medium uppercase">TXN ID Check</p>
                    <p className={`text-sm font-bold ${details.txnIdMatch === "MATCH" ? "text-green-600" : "text-red-600"}`}>
                      {details.txnIdMatch === "MATCH" ? "✓ Match" : "✗ Mismatch"}
                    </p>
                  </div>
                )}
                {details.amountCheck && (
                  <div className="bg-white rounded-lg p-2.5 border border-slate-100">
                    <p className="text-[10px] text-slate-500 font-medium uppercase">Amount Check</p>
                    <p className={`text-sm font-bold ${details.amountCheck === "MATCH" ? "text-green-600" : "text-red-600"}`}>
                      {details.amountCheck === "MATCH" ? "✓ Match" : `✗ ₹${details.amountCheck?.screenshotAmount} vs ₹${details.amountCheck?.orderAmount}`}
                    </p>
                  </div>
                )}
                {details.upiIdCheck && (
                  <div className="bg-white rounded-lg p-2.5 border border-slate-100">
                    <p className="text-[10px] text-slate-500 font-medium uppercase">UPI ID Check</p>
                    <p className={`text-sm font-bold ${details.upiIdCheck === "MATCH" ? "text-green-600" : "text-red-600"}`}>
                      {details.upiIdCheck === "MATCH" ? "✓ Match" : "✗ Mismatch"}
                    </p>
                  </div>
                )}
                {details.exif && (
                  <>
                    <div className="bg-white rounded-lg p-2.5 border border-slate-100">
                      <p className="text-[10px] text-slate-500 font-medium uppercase">Edit Software</p>
                      <p className={`text-sm font-bold ${details.exif.editedBySoftware === "none" ? "text-green-600" : "text-red-600"}`}>
                        {details.exif.editedBySoftware === "none" ? "✓ None" : `✗ ${details.exif.editedBySoftware}`}
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-2.5 border border-slate-100">
                      <p className="text-[10px] text-slate-500 font-medium uppercase">Screenshot Age</p>
                      <p className="text-sm font-bold text-slate-700">
                        {details.exif.ageHours === "unknown" ? "— Unknown" : `${details.exif.ageHours}h ago`}
                      </p>
                    </div>
                  </>
                )}
                {details.blurPercent && (
                  <div className="bg-white rounded-lg p-2.5 border border-slate-100">
                    <p className="text-[10px] text-slate-500 font-medium uppercase">Blur Level</p>
                    <p className={`text-sm font-bold ${details.blurPercent === "unknown" ? "text-slate-400" : parseFloat(details.blurPercent) > 50 ? "text-red-600" : "text-green-600"}`}>
                      {details.blurPercent === "unknown" ? "— Unknown" : details.blurPercent}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Passed Checks */}
          {passed.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-green-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> Passed Checks ({passed.length})
              </h4>
              <div className="bg-green-50/50 border border-green-100 rounded-xl p-3">
                <div className="flex flex-wrap gap-1.5">
                  {passed.map(f => (
                    <span key={f.key} className="text-[11px] text-green-700 bg-green-100 px-2 py-1 rounded-lg font-medium">
                      ✓ {f.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 p-4 bg-slate-50 rounded-b-2xl flex items-center justify-between">
          <p className="text-[10px] text-slate-400">
            {ff.flaggedAt ? `Flagged ${new Date(ff.flaggedAt).toLocaleString("en-IN")}` : "Analysis complete"}
          </p>
          <button onClick={onClose} className="text-xs px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 font-semibold transition-colors">
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function KitShopDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [showSS, setShowSS] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showFraudDetail, setShowFraudDetail] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orders, setOrders] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 0 });
  const itemsPerPage = 10;

  // Restrict access to non-AISSMS shopkeepers
  const shopName = user?.shop?.name || user?.shopName || '';
  const isAissmsShop = user?.role === 'admin' || /aissms|AISSMS/i.test(shopName);

  if (user && user.role !== 'admin' && !isAissmsShop) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
        <div className="max-w-md bg-slate-800 border border-slate-700 rounded-2xl p-8 text-center space-y-4 shadow-2xl">
          <div className="text-4xl">📚</div>
          <h2 className="text-xl font-bold">Kit Orders Exclusive to AISSMS</h2>
          <p className="text-sm text-slate-400">
            The Practical Kit Orders feature is active for <strong>AISSMS College Print Shop</strong>. Your shop ({shopName || 'Partner Shop'}) processes standard print jobs.
          </p>
          <Button onClick={() => navigate('/shop')} className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold">
            Back to Shop Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const currentTab = TABS.find(t => t.key === activeTab);

  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Fix #14: Use lightweight counts endpoint for tab badges instead of fetching 1000 orders
      const [countsRes, ordersRes] = await Promise.all([
        kitAPI.getOrderCounts(),
        kitAPI.getKitOrders({
          status: currentTab?.statuses?.length === 1 ? currentTab.statuses[0] : undefined,
          page: currentPage,
          limit: itemsPerPage,
        }),
      ]);

      setCounts(countsRes.data.data.counts);

      let tabOrders = ordersRes.data.data.orders;

      // If tab has multiple statuses (e.g., pending = Pending Verification + Payment Verified),
      // we need to client-filter since server only supports single status filter
      if (currentTab?.statuses?.length > 1) {
        tabOrders = tabOrders.filter(o => currentTab.statuses.includes(o.orderStatus));
      }

      // Client-side search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        tabOrders = tabOrders.filter(o =>
          o.name?.toLowerCase().includes(q) ||
          o.email?.toLowerCase().includes(q) ||
          o.phone?.includes(q) ||
          o._id?.includes(q)
        );
      }

      setOrders(tabOrders);
      setPagination(ordersRes.data.data.pagination || { total: tabOrders.length, page: currentPage, pages: 1 });
    } catch {
      if (!silent) toast.error("Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [activeTab, currentPage, searchQuery, currentTab]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const handleUpdate = async (id, status, note = "") => {
    setUpdating(id);
    try {
      await kitAPI.updateKitOrderStatus(id, status, note);
      toast.success("Updated — " + status);
      fetchOrders(true);
    } catch (err) {
      toast.error(err.response?.data?.message || "Update failed");
    } finally {
      setUpdating(null);
    }
  };

  const getStatusBadge = (status) => {
    const cfg = STATUS[status] || STATUS["Pending Verification"];
    return <span className={`px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wide ${cfg.badge} border shadow-sm`}>{cfg.label}</span>;
  };

  const totalPages = pagination.pages || 1;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              Kit Orders
              {(counts.pending || 0) > 0 && (
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-red-500 text-white text-xs font-bold">
                  {counts.pending}
                </span>
              )}
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">Review and process incoming kit orders</p>
          </div>
          <button onClick={() => fetchOrders(false)} disabled={loading}
            className="h-10 w-10 flex items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors">
            <RefreshCw className={"h-5 w-5 " + (loading ? "animate-spin" : "")} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-3 mb-6">
          {TABS.map(({ key, label, icon: Icon }) => {
            const count = counts[key] || 0;
            const active = activeTab === key;
            return (
              <button key={key} onClick={() => { setActiveTab(key); setCurrentPage(1); }}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 ${active ? 'bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-lg shadow-slate-900/30' : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
                <Icon className="h-4 w-4" />
                {label}
                {count > 0 && (
                  <span className={`ml-1 px-2.5 py-0.5 rounded-lg text-xs font-bold ${active ? 'bg-slate-700' : 'bg-slate-100 text-slate-700'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Toolbar */}
        <div className="flex gap-3 items-center flex-wrap mb-6">
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input type="text" placeholder="Search by name, email or phone..." value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none text-sm transition-all duration-300 hover:border-slate-300" />
          </div>
          <button onClick={() => setShowFilters(true)} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 hover:border-slate-300 font-medium text-sm transition-all duration-300 group">
            <Filter size={16} className="group-hover:scale-110 transition-transform" /> Filter
          </button>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden hover:shadow-xl transition-shadow duration-300">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="bg-gradient-to-r from-slate-900 to-slate-800 text-slate-200 text-[11px] uppercase tracking-wider font-semibold">
                  <th className="p-4">Date</th>
                  <th className="p-4">Customer</th>
                  <th className="p-4">Year</th>
                  <th className="p-4">Amount</th>
                  <th className="p-4">TXN ID</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="7" className="p-12 text-center text-slate-400">Loading orders...</td></tr>
                ) : orders.length === 0 ? (
                  <tr><td colSpan="7" className="p-12 text-center text-slate-400">No orders found.</td></tr>
                ) : orders.map(order => (
                  <tr key={order._id} className="border-b border-slate-100 hover:bg-gradient-to-r hover:from-orange-50/50 hover:to-amber-50/50 transition-all duration-200 group">
                    <td className="p-4">
                      <div className="text-sm font-semibold text-slate-800">{new Date(order.createdAt).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</div>
                      <div className="text-xs text-slate-500">({new Date(order.createdAt).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true }).toLowerCase()})</div>
                    </td>
                    <td className="p-4">
                      <div className="text-sm font-medium text-slate-800">{order.name}</div>
                      <div className="text-xs text-slate-500">{order.phone}</div>
                    </td>
                    <td className="p-4 text-sm text-slate-600 font-medium">{order.year} {order.department ? "· " + order.department : ""}</td>
                    <td className="p-4 text-sm font-bold text-slate-800">₹{order.totalAmount}</td>
                    <td className="p-4 text-sm font-mono text-slate-600">{order.transactionId || "—"}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {getStatusBadge(order.orderStatus)}
                        {order.fraudFlags?.fraudScore > 0 && (
                          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${order.fraudFlags.fraudScore >= 100 ? 'bg-red-100 text-red-700' : order.fraudFlags.fraudScore >= 60 ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            ⚡{order.fraudFlags.fraudScore}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => { setSelectedOrder(order); setShowSS(true); }} className="p-2 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-all duration-200 hover:scale-110" title="View Screenshot">
                          <Eye size={18} />
                        </button>
                        {order.fraudFlags?.fraudScore > 0 && (
                          <button onClick={() => { setSelectedOrder(order); setShowFraudDetail(true); }} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200 hover:scale-110" title="View Fraud Analysis">
                            <ShieldAlert size={18} />
                          </button>
                        )}
                        <div className="flex flex-col items-end gap-1.5">
                          {order.orderStatus === "Pending Verification" && (
                            <div className="flex gap-1.5">
                              <button onClick={() => handleUpdate(order._id, "Payment Verified")} disabled={updating === order._id} className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-all disabled:opacity-50">
                                {updating === order._id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Verify"}
                              </button>
                              <button onClick={() => { setSelectedOrder(order); setShowReject(true); }} disabled={updating === order._id} className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-semibold transition-all disabled:opacity-50">
                                Reject
                              </button>
                            </div>
                          )}
                          {order.orderStatus === "Payment Verified" && (
                            <div className="flex gap-1.5">
                              <button onClick={() => handleUpdate(order._id, "Accepted")} disabled={updating === order._id} className="text-xs px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition-all disabled:opacity-50">
                                {updating === order._id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Accept"}
                              </button>
                              <button onClick={() => { setSelectedOrder(order); setShowReject(true); }} disabled={updating === order._id} className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-semibold transition-all disabled:opacity-50">
                                Reject
                              </button>
                            </div>
                          )}
                          {order.orderStatus === "Suspicious" && (
                            <div className="flex gap-1.5">
                              <button onClick={() => handleUpdate(order._id, "Payment Verified", "Approved after review")} disabled={updating === order._id} className="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-all disabled:opacity-50">
                                {updating === order._id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Approve"}
                              </button>
                              <button onClick={() => { setSelectedOrder(order); setShowReject(true); }} disabled={updating === order._id} className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-semibold transition-all disabled:opacity-50">
                                Reject
                              </button>
                            </div>
                          )}
                          {order.orderStatus === "Accepted" && (
                            <button onClick={() => handleUpdate(order._id, "Completed")} disabled={updating === order._id} className="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-all disabled:opacity-50">
                              {updating === order._id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Complete"}
                            </button>
                          )}
                          {(order.orderStatus === "Completed" || order.orderStatus === "Rejected") && (
                            <p className="text-xs text-slate-500">No action</p>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-slate-100">
              <span className="text-xs text-slate-600 font-medium">Page {currentPage} of {totalPages} · {pagination.total} orders</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage===1} className="p-2 rounded-lg bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-all duration-200 hover:scale-110"><ChevronLeft size={18} /></button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) pageNum = i + 1;
                  else if (currentPage <= 3) pageNum = i + 1;
                  else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                  else pageNum = currentPage - 2 + i;
                  if (pageNum > 0 && pageNum <= totalPages) {
                    return (<button key={pageNum} onClick={() => setCurrentPage(pageNum)} className={`w-9 h-9 rounded-lg text-sm font-bold transition-all duration-200 ${currentPage === pageNum ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg' : 'bg-white text-slate-600 hover:bg-slate-100 hover:scale-110'}`}>{pageNum}</button>);
                  }
                  return null;
                })}
                {totalPages > 5 && currentPage < totalPages - 2 && <span className="text-slate-400 text-sm px-1">...</span>}
                {totalPages > 5 && currentPage < totalPages - 2 && <button onClick={() => setCurrentPage(totalPages)} className={`w-9 h-9 rounded-lg text-sm font-bold bg-white text-slate-600 hover:bg-slate-100 transition-all duration-200 hover:scale-110`}>{totalPages}</button>}
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage===totalPages} className="p-2 rounded-lg bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-all duration-200 hover:scale-110"><ChevronRight size={18} /></button>
              </div>
            </div>
          )}
        </div>

        {/* Fraud Flags Info */}
        {orders.some(o => o.fraudFlags?.fraudScore > 0) && (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-2xl p-4">
            <p className="text-sm text-red-800"><strong>🚨 Fraud Detection Active:</strong> Some orders have been flagged for review. Check the Suspicious tab for details.</p>
          </div>
        )}
      </div>

      {/* Screenshot Viewer */}
      <AnimatePresence>
        {showSS && selectedOrder?.screenshotUrl && <ScreenshotViewer url={selectedOrder.screenshotUrl} onClose={() => setShowSS(false)} />}
        {showReject && selectedOrder && (
          <RejectModal order={selectedOrder} busy={updating === selectedOrder._id}
            onConfirm={(reason) => { handleUpdate(selectedOrder._id, "Rejected", reason); setShowReject(false); }}
            onClose={() => setShowReject(false)} />
        )}
        {showFraudDetail && selectedOrder && (
          <FraudDetailModal order={selectedOrder} onClose={() => setShowFraudDetail(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
