import React, { useState, useEffect, useCallback } from 'react';
import { 
  Printer, RefreshCw, Search, Edit2, Check, X, Plus, 
  Server, FileCheck, AlertTriangle, RotateCw, Zap, 
  Activity, Layers, Clock, ChevronDown
} from 'lucide-react';
import { printerAPI } from '../../lib/api';
import { getSocket, joinShopRoom } from '../../lib/socket';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';

// ── Animated status dot ──────────────────────────────────────────────────────
const StatusDot = ({ status, isEnabled }) => {
  if (!isEnabled) return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
    </span>
  );
  if (status === 'running') return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
    </span>
  );
  if (status === 'error') return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
    </span>
  );
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
    </span>
  );
};

// ── Format badge ─────────────────────────────────────────────────────────────
const FormatBadge = ({ printer }) => {
  const { supportedFormats = [], preferredFormat } = printer;
  if (!supportedFormats.length) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
        Not detected
      </span>
    );
  }
  if (supportedFormats.includes('application/pdf')) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
        <FileCheck size={10} /> PDF ✓
      </span>
    );
  }
  if (preferredFormat === 'application/postscript') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full" title="PDF auto-converts to PostScript via Ghostscript">
        <FileCheck size={10} /> GS→PS
      </span>
    );
  }
  if (preferredFormat?.includes('PCL') || preferredFormat?.includes('pcl')) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full" title="PDF auto-converts to PCL via Ghostscript">
        <FileCheck size={10} /> GS→PCL
      </span>
    );
  }
  if (preferredFormat === 'application/octet-stream') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full" title="Sending PDF as raw bytes">
        <AlertTriangle size={10} /> Raw
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full" title="No compatible format detected">
      <AlertTriangle size={10} /> Unsupported
    </span>
  );
};

// ── Stat item ────────────────────────────────────────────────────────────────
const StatItem = ({ icon: Icon, label, value, suffix, color = 'text-slate-900' }) => (
  <div className="flex flex-col items-center gap-1 px-3">
    <div className="flex items-center gap-1.5">
      <Icon size={13} className="text-slate-400" />
      <span className={`text-xl font-extrabold ${color} leading-none tabular-nums`}>
        {value}
        {suffix && <span className="text-xs font-semibold text-slate-400 ml-0.5">{suffix}</span>}
      </span>
    </div>
    <span className="text-[9px] text-slate-400 uppercase tracking-[0.12em] font-bold">{label}</span>
  </div>
);

// ── Load bar colors ──────────────────────────────────────────────────────────
const getLoadColor = (pct) => {
  if (pct > 80) return 'from-red-500 to-rose-500';
  if (pct > 50) return 'from-amber-400 to-orange-500';
  return 'from-emerald-400 to-green-500';
};

const getLoadBg = (pct) => {
  if (pct > 80) return 'bg-red-50';
  if (pct > 50) return 'bg-amber-50';
  return 'bg-emerald-50';
};

// ═════════════════════════════════════════════════════════════════════════════
// Main component
// ═════════════════════════════════════════════════════════════════════════════
const ShopPrinters = () => {
  const { user } = useAuth();
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Name edit
  const [editingPrinterId, setEditingPrinterId] = useState(null);
  const [editingName, setEditingName] = useState('');
  
  // IP edit
  const [editingIpId, setEditingIpId] = useState(null);
  const [editingIpValue, setEditingIpValue] = useState('');

  // Add modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newPrinter, setNewPrinter] = useState({ name: '', type: 'bw', ipAddress: '' });
  const [isAdding, setIsAdding] = useState(false);

  // Format detection
  const [detectingId, setDetectingId] = useState(null);

  // ── Data fetch ──────────────────────────────────────────────────────────────
  const fetchPrinters = useCallback(async () => {
    try {
      setRefreshing(true);
      const res = await printerAPI.getShopPrinters();
      setPrinters(res.data?.data?.printers || []);
    } catch (err) {
      console.error('Failed to fetch printers:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // ── Socket ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchPrinters();
    const s = getSocket();
    if (user?.shop?._id && s) {
      const shopId = user.shop._id;
      if (s.connected) joinShopRoom(shopId);
      else s.on('connect', () => joinShopRoom(shopId));
    }

    const onPrinterUpdate = (data) => {
      if (data?.printers) {
        setPrinters(prev => {
          const updated = [...prev];
          data.printers.forEach(incoming => {
            const idx = updated.findIndex(p => p._id === incoming._id);
            if (idx >= 0) updated[idx] = { ...updated[idx], ...incoming };
            else updated.push(incoming);
          });
          return updated;
        });
      }
    };
    const onConnect = () => { if (user?.shop?._id) joinShopRoom(user.shop._id); };

    s.on('connect', onConnect);
    s.on('printer:status_update', onPrinterUpdate);
    return () => { s.off('connect', onConnect); s.off('printer:status_update', onPrinterUpdate); };
  }, [fetchPrinters, user]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const handleToggle = async (id, currentState) => {
    setPrinters(prev => prev.map(p => p._id === id ? { ...p, isEnabled: !currentState, status: !currentState ? 'running' : 'stopped' } : p));
    try {
      await printerAPI.togglePrinter(id, !currentState);
      toast.success(!currentState ? 'Printer enabled' : 'Printer disabled');
    } catch {
      fetchPrinters();
      toast.error('Failed to toggle printer');
    }
  };

  const handleAddPrinter = async (e) => {
    e.preventDefault();
    if (!newPrinter.name || !newPrinter.ipAddress) return toast.error('Name and IP Address are required');
    try {
      setIsAdding(true);
      await printerAPI.addManualPrinter(newPrinter);
      toast.success('Printer added successfully!');
      setIsAddModalOpen(false);
      setNewPrinter({ name: '', type: 'bw', ipAddress: '' });
      fetchPrinters();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add printer');
    } finally {
      setIsAdding(false);
    }
  };

  const handleSaveName = async (printerId) => {
    if (!editingName.trim()) return toast.error('Display name cannot be empty');
    try {
      await printerAPI.updateDisplayName(printerId, editingName.trim());
      setPrinters(prev => prev.map(p => p._id === printerId ? { ...p, displayName: editingName.trim() } : p));
      setEditingPrinterId(null);
      toast.success('Name updated');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update name');
    }
  };

  const handleSaveIp = async (printerId) => {
    if (!editingIpValue.trim()) return toast.error('IP Address cannot be empty');
    try {
      await printerAPI.updateIp(printerId, editingIpValue.trim());
      setPrinters(prev => prev.map(p => p._id === printerId ? { ...p, ipAddress: editingIpValue.trim() } : p));
      setEditingIpId(null);
      toast.success('IP updated');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update IP');
    }
  };

  const handleDetectFormats = async (printerId) => {
    try {
      setDetectingId(printerId);
      const res = await printerAPI.detectFormats(printerId);
      const msg = res.data?.message || 'Detection complete';
      res.data?.success ? toast.success(msg) : toast.warning(msg);
      fetchPrinters();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Format detection failed');
    } finally {
      setDetectingId(null);
    }
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const filtered = printers.filter(p =>
    p.ipAddress &&
    (p.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.systemName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.displayName?.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const onlineCount = printers.filter(p => p.isEnabled && p.status === 'running').length;
  const totalJobs = printers.reduce((s, p) => s + (p.jobsInQueue || 0), 0);
  const totalPages = printers.reduce((s, p) => s + (p.currentLoad || 0), 0);

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-slate-200 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1,2,3].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4 animate-pulse">
              <div className="flex gap-3"><div className="w-12 h-12 bg-slate-200 rounded-xl" /><div className="space-y-2 flex-1"><div className="h-4 w-32 bg-slate-200 rounded" /><div className="h-3 w-24 bg-slate-100 rounded" /></div></div>
              <div className="h-2 bg-slate-100 rounded-full" />
              <div className="flex justify-around"><div className="h-8 w-12 bg-slate-100 rounded" /><div className="h-8 w-12 bg-slate-100 rounded" /><div className="h-8 w-12 bg-slate-100 rounded" /></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Printers</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {printers.length === 0 
              ? 'No printers configured yet' 
              : `${onlineCount} online · ${totalJobs} jobs · ${totalPages} pages queued`
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={fetchPrinters} 
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all duration-200 disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <button 
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-orange-500 to-orange-600 rounded-xl hover:from-orange-600 hover:to-orange-700 shadow-sm shadow-orange-500/20 hover:shadow-md hover:shadow-orange-500/30 transition-all duration-200"
          >
            <Plus size={15} /> Add Printer
          </button>
        </div>
      </div>

      {/* ── Search ──────────────────────────────────────────────────────────── */}
      {printers.length > 0 && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Search by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-orange-500/30 focus:border-orange-400 outline-none transition-all duration-200"
          />
        </div>
      )}

      {/* ── Add Printer Modal ──────────────────────────────────────────────── */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setIsAddModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()} style={{ animation: 'modalIn 0.2s ease-out' }}>
            {/* Modal header */}
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-500/20 rounded-xl flex items-center justify-center">
                    <Printer className="text-orange-400" size={20} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">Add Printer</h2>
                    <p className="text-xs text-slate-400">Connect via IPP protocol</p>
                  </div>
                </div>
                <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-700">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal body */}
            <form onSubmit={handleAddPrinter} className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Printer Name</label>
                <input 
                  type="text" required value={newPrinter.name} 
                  onChange={e => setNewPrinter({...newPrinter, name: e.target.value})}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500/30 focus:border-orange-400 outline-none transition-all"
                  placeholder="e.g. HP Color LaserJet" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Type</label>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    type="button" 
                    onClick={() => setNewPrinter({...newPrinter, type: 'bw'})}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-200 ${
                      newPrinter.type === 'bw' 
                        ? 'border-slate-900 bg-slate-900 text-white' 
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <span className="w-3 h-3 rounded-full bg-slate-600 border-2 border-slate-400" /> B&W
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setNewPrinter({...newPrinter, type: 'color'})}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-200 ${
                      newPrinter.type === 'color' 
                        ? 'border-orange-500 bg-orange-500 text-white' 
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <span className="w-3 h-3 rounded-full bg-gradient-to-br from-cyan-400 via-purple-400 to-pink-400" /> Color
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">IP Address / Hostname</label>
                <input 
                  type="text" required value={newPrinter.ipAddress} 
                  onChange={e => setNewPrinter({...newPrinter, ipAddress: e.target.value})}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-orange-500/30 focus:border-orange-400 outline-none transition-all"
                  placeholder="e.g. 192.168.1.50" 
                />
                <p className="text-[11px] text-slate-400 mt-1.5">Static IP of the printer on your network</p>
              </div>
              <button 
                type="submit" disabled={isAdding}
                className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold rounded-xl py-3 hover:from-orange-600 hover:to-orange-700 disabled:opacity-50 shadow-sm shadow-orange-500/20 hover:shadow-md hover:shadow-orange-500/30 transition-all duration-200 text-sm"
              >
                {isAdding ? (
                  <span className="flex items-center justify-center gap-2">
                    <RefreshCw size={14} className="animate-spin" /> Adding...
                  </span>
                ) : 'Add Printer'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Empty state ────────────────────────────────────────────────────── */}
      {filtered.length === 0 && printers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <div className="mx-auto w-20 h-20 bg-gradient-to-br from-slate-100 to-slate-50 rounded-2xl flex items-center justify-center mb-5 shadow-inner">
            <Printer className="text-slate-400" size={36} />
          </div>
          <h3 className="text-lg font-extrabold text-slate-800 mb-2">No Printers Yet</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6 leading-relaxed">
            Add your network printers using their IP address to start receiving automated print jobs.
          </p>
          <button 
            onClick={() => setIsAddModalOpen(true)} 
            className="inline-flex items-center gap-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:from-orange-600 hover:to-orange-700 shadow-sm shadow-orange-500/20 hover:shadow-md transition-all duration-200"
          >
            <Plus size={16} /> Add Your First Printer
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
          <Search className="mx-auto text-slate-300 mb-3" size={32} />
          <p className="text-sm text-slate-500">No printers match "<span className="font-semibold">{searchQuery}</span>"</p>
        </div>
      ) : (

      /* ── Printer Grid ────────────────────────────────────────────────────── */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((printer) => {
            const loadPct = printer.ppm > 0 
              ? Math.min(100, Math.round((printer.currentLoad / (printer.ppm * 5)) * 100)) 
              : 0;
            const statusLabel = !printer.isEnabled ? 'Disabled' : printer.status === 'running' ? 'Online' : printer.status === 'error' ? 'Error' : printer.status === 'offline' ? 'Offline' : 'Stopped';
            const statusColor = !printer.isEnabled ? 'text-slate-400' : printer.status === 'running' ? 'text-emerald-600' : printer.status === 'error' ? 'text-red-600' : 'text-slate-400';

            return (
              <div 
                key={printer._id} 
                className={`group relative bg-white rounded-2xl border transition-all duration-300 overflow-hidden ${
                  printer.isEnabled 
                    ? 'border-slate-100 shadow-sm hover:shadow-lg hover:border-slate-200 hover:-translate-y-0.5' 
                    : 'border-slate-100 opacity-60 hover:opacity-80'
                }`}
              >
                {/* Top accent bar */}
                <div className={`h-1 transition-all duration-500 ${
                  !printer.isEnabled ? 'bg-slate-200' :
                  printer.status === 'running' ? 'bg-gradient-to-r from-emerald-400 to-green-500' :
                  printer.status === 'error' ? 'bg-gradient-to-r from-red-400 to-rose-500' :
                  'bg-gradient-to-r from-slate-300 to-slate-200'
                }`} />

                <div className="p-5">
                  {/* ── Header row ──────────────────────────────────────────── */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {/* Printer icon */}
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-300 ${
                        printer.type === 'color' 
                          ? 'bg-gradient-to-br from-violet-500 to-purple-600' 
                          : 'bg-gradient-to-br from-slate-800 to-slate-900'
                      }`}>
                        <Printer className="text-white" size={18} />
                      </div>

                      <div className="min-w-0 flex-1">
                        {/* Name (editable) */}
                        {editingPrinterId === printer._id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              className="font-bold text-slate-900 text-sm border border-orange-400 rounded-lg px-2 py-0.5 w-full max-w-[160px] focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                              maxLength={30}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveName(printer._id);
                                if (e.key === 'Escape') setEditingPrinterId(null);
                              }}
                            />
                            <button onClick={() => handleSaveName(printer._id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"><Check size={14} /></button>
                            <button onClick={() => setEditingPrinterId(null)} className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition-colors"><X size={14} /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <h3 className="font-extrabold text-slate-900 text-sm truncate leading-tight">
                              {printer.displayName || printer.name}
                            </h3>
                            <button 
                              onClick={() => { setEditingPrinterId(printer._id); setEditingName(printer.displayName || printer.name); }} 
                              className="p-0.5 text-slate-300 hover:text-orange-500 rounded transition-colors opacity-0 group-hover:opacity-100"
                              title="Edit name"
                            >
                              <Edit2 size={11} />
                            </button>
                          </div>
                        )}

                        {/* Type + Status */}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${
                            printer.type === 'color' 
                              ? 'bg-violet-50 text-violet-600' 
                              : 'bg-slate-100 text-slate-500'
                          }`}>
                            {printer.type === 'color' ? 'Color' : 'B&W'}
                          </span>
                          <span className="text-slate-200">·</span>
                          <div className="flex items-center gap-1">
                            <StatusDot status={printer.status} isEnabled={printer.isEnabled} />
                            <span className={`text-[11px] font-semibold ${statusColor}`}>{statusLabel}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Toggle switch */}
                    <button
                      onClick={() => handleToggle(printer._id, printer.isEnabled)}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-all duration-300 shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                        printer.isEnabled ? 'bg-emerald-500 focus:ring-emerald-500/50' : 'bg-slate-200 focus:ring-slate-300'
                      }`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-all duration-300 shadow-sm ${
                        printer.isEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>

                  {/* ── IP Address ──────────────────────────────────────────── */}
                  <div className="mt-3">
                    {editingIpId === printer._id ? (
                      <div className="flex items-center gap-1">
                        <Server size={12} className="text-slate-400 shrink-0" />
                        <input 
                          type="text" value={editingIpValue} onChange={(e) => setEditingIpValue(e.target.value)}
                          className="text-xs font-mono text-slate-600 border border-blue-300 rounded-lg px-2 py-1 w-full max-w-[180px] outline-none focus:ring-2 focus:ring-blue-500/30"
                          placeholder="IP Address" autoFocus 
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveIp(printer._id); if (e.key === 'Escape') setEditingIpId(null); }} 
                        />
                        <button onClick={() => handleSaveIp(printer._id)} className="p-0.5 text-emerald-600 hover:bg-emerald-50 rounded"><Check size={12} /></button>
                        <button onClick={() => setEditingIpId(null)} className="p-0.5 text-red-500 hover:bg-red-50 rounded"><X size={12} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 group/ip cursor-pointer" onClick={() => { setEditingIpId(printer._id); setEditingIpValue(printer.ipAddress || ''); }}>
                        <Server size={11} className="text-slate-300" />
                        <span className="text-[11px] font-mono text-slate-400 group-hover/ip:text-slate-600 transition-colors">
                          {printer.ipAddress || 'No IP configured'}
                        </span>
                        <Edit2 size={9} className="text-slate-300 group-hover/ip:text-blue-500 transition-colors" />
                      </div>
                    )}
                  </div>

                  {/* ── Format + Model row ──────────────────────────────────── */}
                  <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                    <FormatBadge printer={printer} />
                    {printer.printerModel && (
                      <span className="text-[10px] text-slate-400 truncate max-w-[140px]" title={printer.printerModel}>
                        {printer.printerModel}
                      </span>
                    )}
                    <button
                      onClick={() => handleDetectFormats(printer._id)}
                      disabled={detectingId === printer._id}
                      className="p-1 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all disabled:opacity-50"
                      title="Detect formats & duplex"
                    >
                      <RotateCw size={11} className={detectingId === printer._id ? 'animate-spin' : ''} />
                    </button>
                  </div>

                  {/* ── Duplex capability badge ─────────────────────────────── */}
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    {printer.supportsDuplex === true && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full"
                        title={`Sides supported: ${(printer.sidesSupported || []).join(', ')}`}>
                        ✓ Duplex
                      </span>
                    )}
                    {printer.supportsDuplex === false && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"
                        title="Printer has no duplex unit — 2-side orders will print single-sided">
                        ⚠ No Duplex
                      </span>
                    )}
                    {(printer.supportsDuplex === null || printer.supportsDuplex === undefined) && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full"
                        title="Click the refresh icon to detect duplex support">
                        ? Duplex unknown — click ↺
                      </span>
                    )}
                  </div>

                  {/* ── Load bar ────────────────────────────────────────────── */}
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Load</span>
                      <span className={`text-[11px] font-bold ${loadPct > 80 ? 'text-red-500' : loadPct > 50 ? 'text-amber-500' : 'text-emerald-500'}`}>
                        {loadPct}%
                      </span>
                    </div>
                    <div className={`w-full h-1.5 rounded-full overflow-hidden ${getLoadBg(loadPct)}`}>
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${getLoadColor(loadPct)} transition-all duration-700 ease-out`}
                        style={{ width: `${Math.max(loadPct, 0)}%` }}
                      />
                    </div>
                  </div>

                  {/* ── Stats row ───────────────────────────────────────────── */}
                  <div className="mt-4 flex items-center justify-around">
                    <StatItem icon={Layers} label="Queue" value={printer.jobsInQueue || 0} />
                    <div className="w-px h-8 bg-slate-100" />
                    <StatItem icon={Activity} label="Pages" value={printer.currentLoad || 0} />
                    <div className="w-px h-8 bg-slate-100" />
                    <StatItem 
                      icon={Clock} label="Wait" 
                      value={printer.ppm > 0 ? Math.round((printer.currentLoad || 0) / printer.ppm * 10) / 10 : 0} 
                      suffix="m" 
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Inline CSS for modal animation ─────────────────────────────────── */}
      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default ShopPrinters;
