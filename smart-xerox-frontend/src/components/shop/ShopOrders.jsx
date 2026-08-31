import React, { useState, useEffect, useCallback } from 'react';
import { Search, Filter, RefreshCw, ChevronLeft, ChevronRight, Eye, X, Ban, KeyRound, Printer } from 'lucide-react';
import { shopAPI } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { toast } from 'sonner';

const ShopOrders = ({ handleReject, triggerPrint, handleVerifyPickup, handleUpdateStatus, navigate }) => {
  const [activeTab, setActiveTab] = useState('live');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [filterSection, setFilterSection] = useState('day');
  const [filterDay, setFilterDay] = useState('all');
  const [filterStatus, setFilterStatus] = useState('');
  const [showAmount, setShowAmount] = useState(true);
  const [rejectModal, setRejectModal] = useState({ open: false, orderId: null, reason: '' });
  const [otpModal, setOtpModal] = useState({ open: false, order: null, otp: '' });
  const [detailsModal, setDetailsModal] = useState({ open: false, order: null });

  // Dynamic data from DB
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 0 });
  const itemsPerPage = 10;

  // Build query string from current filters
  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set('limit', itemsPerPage);
    params.set('page', currentPage);

    // Status filter based on active tab
    if (activeTab === 'live') {
      // Live Orders: only orders still being processed (not yet ready for pickup)
      params.set('status', 'paid,queued,accepted,printing');
    } else {
      if (filterStatus) {
        params.set('status', filterStatus);
      } else {
        // Order History: completed and final status orders
        params.set('status', 'ready,picked_up,cancelled,expired,rejected,refunded');
      }
    }

    // Date range filter
    if (filterDay !== 'all') {
      const now = new Date();
      const fmt = (d) => d.toISOString().split('T')[0];

      if (filterDay === 'today') {
        params.set('date', fmt(now));
      } else if (filterDay === 'yesterday') {
        const y = new Date(now); y.setDate(y.getDate() - 1);
        params.set('date', fmt(y));
      } else if (filterDay === 'this_week') {
        const start = new Date(now);
        start.setDate(start.getDate() - start.getDay()); // Sunday
        params.set('startDate', fmt(start));
        params.set('endDate', fmt(now));
      } else if (filterDay === 'last_week') {
        const end = new Date(now);
        end.setDate(end.getDate() - end.getDay() - 1); // Last Saturday
        const start = new Date(end);
        start.setDate(start.getDate() - 6); // Previous Sunday
        params.set('startDate', fmt(start));
        params.set('endDate', fmt(end));
      } else if (filterDay === 'this_month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        params.set('startDate', fmt(start));
        params.set('endDate', fmt(now));
      } else if (filterDay === 'last_month') {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0); // Last day of prev month
        params.set('startDate', fmt(start));
        params.set('endDate', fmt(end));
      } else if (filterDay === 'last_year') {
        const start = new Date(now.getFullYear() - 1, 0, 1);
        const end = new Date(now.getFullYear() - 1, 11, 31);
        params.set('startDate', fmt(start));
        params.set('endDate', fmt(end));
      }
    }

    return params.toString();
  }, [activeTab, currentPage, filterStatus, filterDay]);

  // Fetch orders from API
  const fetchOrders = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const query = buildQuery();
      const res = await shopAPI.getShopOrders(query);
      const data = res.data.data || res.data;
      setOrders(data.orders || []);
      setPagination(data.pagination || { total: 0, page: 1, pages: 0 });
    } catch {
      if (!silent) toast.error('Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  // Refetch when filters change
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Real-time socket updates
  useEffect(() => {
    const s = getSocket();
    const refresh = () => fetchOrders(true);

    const onPrintError = (data) => {
      toast.error(`❌ Print Error: ${data.error}`);
      refresh();
    };

    s.on('order:status_update', refresh);
    s.on('order:new', refresh);
    s.on('print:started', refresh);
    s.on('print:completed', refresh);
    s.on('print:out_of_paper', refresh);
    s.on('print:error', onPrintError);

    return () => {
      s.off('order:status_update', refresh);
      s.off('order:new', refresh);
      s.off('print:started', refresh);
      s.off('print:completed', refresh);
      s.off('print:out_of_paper', refresh);
      s.off('print:error', onPrintError);
    };
  }, [fetchOrders]);

  // Client-side search on fetched results
  const displayOrders = searchQuery
    ? orders.filter(o => {
      const q = searchQuery.toLowerCase();
      return o.pickup?.pickupCode?.includes(q) ||
        o.orderNumber?.toLowerCase().includes(q) ||
        o.user?.name?.toLowerCase().includes(q) ||
        o.user?.phone?.includes(q) ||
        o.user?.email?.toLowerCase().includes(q) ||
        o.assignedPrinterName?.toLowerCase().includes(q) ||
        o.status?.toLowerCase().includes(q);
    })
    : orders;

  // Stats for history tab
  const historyStats = {
    transactions: pagination.total || displayOrders.length,
    pages: displayOrders.reduce((s, o) => s + (o.printJob?.totalPages || o.documents?.reduce((a, d) => {
      if (d.printingRanges && d.printingRanges.length > 0) {
        return a + d.printingRanges.reduce((rs, r) => rs + ((r.rangeEnd - r.rangeStart + 1) * (r.copies || 1)), 0);
      }
      return a + (d.detectedPages || 1);
    }, 0) || 0), 0),
    amount: displayOrders.filter(o => o.status !== 'cancelled' && o.status !== 'rejected').reduce((s, o) => s + (o.pricing?.total || 0), 0).toFixed(2),
  };

  // Live count (separate quick fetch)
  const [liveCount, setLiveCount] = useState(0);
  useEffect(() => {
    const fetchLiveCount = async () => {
      try {
        const res = await shopAPI.getShopOrders('status=paid,queued,accepted,printing&limit=1');
        setLiveCount(res.data.data?.pagination?.total || 0);
      } catch { /* silent */ }
    };
    fetchLiveCount();
  }, [orders]);

  const getStatusBadge = (status) => {
    const map = {
      paid: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'PENDING', border: 'border-yellow-200' },
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'PENDING', border: 'border-yellow-200' },
      queued: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'QUEUED', border: 'border-blue-200' },
      accepted: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'ACCEPTED', border: 'border-indigo-200' },
      printing: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'PRINTING', border: 'border-purple-200' },
      ready: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'READY', border: 'border-emerald-200' },
      picked_up: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'COMPLETED', border: 'border-slate-200' },
      cancelled: { bg: 'bg-rose-100', text: 'text-rose-700', label: 'CANCELLED', border: 'border-rose-200' },
      expired: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'EXPIRED', border: 'border-orange-200' },
      rejected: { bg: 'bg-rose-100', text: 'text-rose-700', label: 'REJECTED', border: 'border-rose-200' },
      refunded: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'REFUNDED', border: 'border-indigo-200' },
    };
    const s = map[status] || map.pending;
    return <span className={`px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wide ${s.bg} ${s.text} border ${s.border} shadow-sm`}>{s.label}</span>;
  };

  const totalPages = pagination.pages || 1;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Orders</h1>

      {/* Tabs */}
      <div className="flex gap-3">
        <button onClick={() => { setActiveTab('live'); setCurrentPage(1); setFilterStatus(''); }}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 ${activeTab === 'live' ? 'bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-lg shadow-slate-900/30' : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
          <span className={`w-2.5 h-2.5 rounded-full ${activeTab === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-emerald-400'}`}></span>
          Live Orders
          <span className={`ml-1 px-2.5 py-0.5 rounded-lg text-xs font-bold ${activeTab === 'live' ? 'bg-slate-700' : 'bg-slate-100 text-slate-700'}`}>{liveCount}</span>
        </button>
        <button onClick={() => { setActiveTab('history'); setCurrentPage(1); }}
          className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 ${activeTab === 'history' ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30' : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
          📋 Order History
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input type="text" placeholder="Search by order no or mobile..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none text-sm transition-all duration-300 hover:border-slate-300" />
        </div>
        <button onClick={() => setShowFilters(true)} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 hover:border-slate-300 font-medium text-sm transition-all duration-300 group">
          <Filter size={16} className="group-hover:scale-110 transition-transform" /> Filter
          {(filterStatus || filterDay !== 'all') && <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>}
        </button>
        <button onClick={() => fetchOrders()} className="p-2.5 bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-xl hover:shadow-lg transition-all duration-300 hover:scale-110">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* History Stats */}
      {activeTab === 'history' && (
        <div className="flex gap-8 bg-gradient-to-r from-slate-50 to-slate-100 p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-300">
          <div className="flex-1">
            <p className="text-[11px] text-slate-600 uppercase font-bold tracking-wider">Transactions</p>
            <p className="text-3xl font-bold text-slate-900 mt-1">{historyStats.transactions}</p>
          </div>
          <div className="flex-1">
            <p className="text-[11px] text-blue-600 uppercase font-bold tracking-wider">Pages</p>
            <p className="text-3xl font-bold text-slate-900 mt-1">{historyStats.pages}</p>
          </div>
          <div className="flex-1">
            <p className="text-[11px] text-emerald-600 uppercase font-bold tracking-wider">Amount</p>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-3xl font-bold text-slate-900">{showAmount ? `₹${historyStats.amount}` : '₹•••••'}</p>
              <button onClick={() => setShowAmount(!showAmount)} className="text-xs text-orange-600 hover:text-orange-700 font-semibold hover:underline transition-colors">{showAmount ? 'Hide' : 'Show'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden hover:shadow-xl transition-shadow duration-300">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="bg-gradient-to-r from-slate-900 to-slate-800 text-slate-200 text-[11px] uppercase tracking-wider font-semibold">
                <th className="p-4">Date</th>
                <th className="p-4">Order No</th>
                <th className="p-4">User</th>
                <th className="p-4">Printer</th>
                <th className="p-4">Pages</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="8" className="p-12 text-center text-slate-400">Loading orders...</td></tr>
              ) : displayOrders.length === 0 ? (
                <tr><td colSpan="8" className="p-12 text-center text-slate-400">No orders found.</td></tr>
              ) : displayOrders.map(order => (
                <tr key={order._id} className="border-b border-slate-100 hover:bg-gradient-to-r hover:from-orange-50/50 hover:to-amber-50/50 transition-all duration-200 group">
                  <td className="p-4">
                    <div className="text-sm font-semibold text-slate-800">{new Date(order.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                    <div className="text-xs text-slate-500">({new Date(order.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase()})</div>
                  </td>
                  <td className="p-4">
                    <span className="font-bold text-orange-600 group-hover:text-orange-700 transition-colors text-lg">
                      {order.pickup?.pickupCode || order.orderNumber || order._id.slice(-6)}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="text-sm font-medium text-slate-800">{order.user?.phone || order.user?.name || 'Guest'}</div>
                  </td>
                  <td className="p-4 text-sm text-slate-700 font-medium">
                    {order.assignedPrinterName || order.assignedPrinter?.name || order.assignedPrinter?.displayName || (
                      <span className="text-slate-400 text-xs italic">No printer assigned</span>
                    )}
                  </td>
                  <td className="p-4 text-sm text-slate-600">{order.printJob?.totalPages || order.documents?.reduce((a, d) => {
                    if (d.printingRanges && d.printingRanges.length > 0) {
                      return a + d.printingRanges.reduce((s, r) => s + ((r.rangeEnd - r.rangeStart + 1) * (r.copies || 1)), 0);
                    }
                    return a + (d.detectedPages || 1);
                  }, 0) || 0}</td>
                  <td className="p-4 text-sm font-bold text-slate-800">₹{(order.pricing?.total || 0)}</td>
                  <td className="p-4">{getStatusBadge(order.status)}</td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setDetailsModal({ open: true, order })} className="p-2 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-all duration-200 hover:scale-110" title="View Details">
                        <Eye size={18} />
                      </button>
                      {['paid', 'queued', 'accepted'].includes(order.status) && (
                        <button
                          onClick={() => setRejectModal({ open: true, orderId: order._id, reason: '' })}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all duration-200"
                          title="Reject order"
                        >
                          <Ban size={18} />
                        </button>
                      )}
                      {['paid', 'queued', 'accepted', 'printing'].includes(order.status) && triggerPrint && (
                        <button
                          onClick={() => triggerPrint(order._id)}
                          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all duration-200"
                          title="Send to printer"
                        >
                          <Printer size={18} />
                        </button>
                      )}
                      {order.status === 'ready' && (
                        <button
                          onClick={() => setOtpModal({ open: true, order, otp: '' })}
                          className="px-2.5 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-all"
                          title="Verify pickup OTP"
                        >
                          <KeyRound size={14} className="inline mr-1" />
                          Verify OTP
                        </button>
                      )}
                      <div className="flex flex-col items-end gap-1.5">
                        {['paid', 'queued', 'accepted'].includes(order.status) && (
                          <button
                            onClick={() => triggerPrint ? triggerPrint(order._id) : setDetailsModal({ open: true, order })}
                            className="px-3.5 py-1.5 text-xs font-bold text-white sunrise-gradient rounded-xl shadow-md shadow-orange-500/20 hover:scale-105 transition-all flex items-center gap-1.5 shrink-0"
                          >
                            <Printer size={14} />
                            {order.status === 'accepted' ? 'Process / Print' : 'Print Order'}
                          </button>
                        )}
                        {order.status === 'printing' && (
                          <span className="text-xs text-purple-700 font-bold px-3 py-1.5 bg-purple-50 rounded-xl border border-purple-200 animate-pulse flex items-center gap-1.5 shadow-sm">
                            <Printer size={14} className="animate-spin text-purple-600" />
                            Printing in Progress...
                          </span>
                        )}
                        {order.status === 'ready' && (
                          <span className="text-xs text-emerald-700 font-bold px-3 py-1.5 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center gap-1 shadow-sm">
                            ✅ Ready for Pickup
                          </span>
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
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-2 rounded-lg bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-all duration-200 hover:scale-110"><ChevronLeft size={18} /></button>
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
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-2 rounded-lg bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-all duration-200 hover:scale-110"><ChevronRight size={18} /></button>
            </div>
          </div>
        )}
      </div>

      {/* Filter Modal */}
      {showFilters && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={() => setShowFilters(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6 flex justify-between items-center border-b border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100">
              <h3 className="text-xl font-bold text-slate-900">Filters</h3>
              <button onClick={() => { setFilterDay('all'); setFilterStatus(''); setFilterSection('day'); }} className="text-sm text-orange-600 font-semibold hover:text-orange-700 transition-colors">Clear All</button>
            </div>
            <div className="p-6 flex gap-6 min-h-[260px]">
              <div className="space-y-1 min-w-[120px] border-r border-slate-200 pr-4">
                <button onClick={() => setFilterSection('day')}
                  className={`w-full text-left px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${filterSection === 'day' ? 'text-orange-600 bg-orange-50 border-l-[3px] border-orange-500' : 'text-slate-600 hover:bg-slate-50 border-l-[3px] border-transparent'}`}>
                  Day
                </button>
                <button onClick={() => setFilterSection('status')}
                  className={`w-full text-left px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${filterSection === 'status' ? 'text-orange-600 bg-orange-50 border-l-[3px] border-orange-500' : 'text-slate-600 hover:bg-slate-50 border-l-[3px] border-transparent'}`}>
                  Order Status
                </button>
              </div>
              <div className="flex-1 space-y-3">
                {filterSection === 'day' && (
                  <>
                    {[
                      { value: 'all', label: 'All Time' },
                      { value: 'today', label: 'Today' },
                      { value: 'yesterday', label: 'Yesterday' },
                      { value: 'this_week', label: 'This Week' },
                      { value: 'last_week', label: 'Last Week' },
                      { value: 'this_month', label: 'This Month' },
                      { value: 'last_month', label: 'Last Month' },
                      { value: 'last_year', label: 'Last Year' },
                    ].map(d => (
                      <label key={d.value} className="flex items-center gap-3 cursor-pointer group">
                        <input type="radio" name="dayFilter" checked={filterDay === d.value} onChange={() => { setFilterDay(d.value); setCurrentPage(1); }} className="w-4 h-4 text-orange-500 accent-orange-500" />
                        <span className="text-sm text-slate-700 font-medium group-hover:text-slate-900 transition-colors">{d.label}</span>
                      </label>
                    ))}
                  </>
                )}
                {filterSection === 'status' && (
                  <>
                    {[
                      { value: '', label: 'All Statuses' },
                      { value: 'picked_up', label: 'Completed' },
                      { value: 'cancelled', label: 'Cancelled' },
                      { value: 'expired', label: 'Expired' },
                      { value: 'rejected', label: 'Rejected' },
                      { value: 'refunded', label: 'Refunded' },
                    ].map(s => (
                      <label key={s.value} className="flex items-center gap-3 cursor-pointer group">
                        <input type="radio" name="statusFilter" checked={filterStatus === s.value} onChange={() => { setFilterStatus(s.value); setCurrentPage(1); }} className="w-4 h-4 text-orange-500 accent-orange-500" />
                        <span className="text-sm text-slate-700 font-medium group-hover:text-slate-900 transition-colors">{s.label}</span>
                      </label>
                    ))}
                  </>
                )}
              </div>
            </div>
            <div className="p-6 pt-0">
              <button onClick={() => setShowFilters(false)} className="w-full py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold rounded-xl hover:shadow-lg transition-all duration-300 hover:scale-105">Apply Filters</button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={() => setRejectModal({ open: false, orderId: null, reason: '' })}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 mb-4">Reject Order</h3>
            <textarea value={rejectModal.reason} onChange={e => setRejectModal({ ...rejectModal, reason: e.target.value })} placeholder="Reason for rejection..." className="w-full border border-slate-200 rounded-xl p-3 text-sm min-h-[80px] focus:ring-2 focus:ring-orange-500 outline-none transition-all duration-300" />
            <div className="flex gap-3 mt-6">
              <button onClick={() => setRejectModal({ open: false, orderId: null, reason: '' })} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-slate-600 font-medium hover:bg-slate-50 transition-all duration-300">Cancel</button>
              <button onClick={async () => { await handleReject(rejectModal.orderId, rejectModal.reason); setRejectModal({ open: false, orderId: null, reason: '' }); fetchOrders(true); }} disabled={!rejectModal.reason.trim()} className="flex-1 py-2.5 bg-gradient-to-r from-rose-500 to-rose-600 text-white rounded-xl font-bold hover:shadow-lg disabled:opacity-50 transition-all duration-300">Reject</button>
            </div>
          </div>
        </div>
      )}

      {/* OTP Verify Modal */}
      {otpModal.open && otpModal.order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={() => setOtpModal({ open: false, order: null, otp: '' })}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 mb-1">Verify Pickup</h3>
            <p className="text-sm text-slate-600 mb-6">Enter OTP for Order <span className="font-bold text-orange-600">#{otpModal.order.pickup?.pickupCode || otpModal.order.orderNumber}</span></p>
            <input type="text" autoFocus placeholder="Enter OTP" className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-orange-500 outline-none text-center text-3xl tracking-[0.35em] font-mono font-bold transition-all duration-300" maxLength={4} value={otpModal.otp}
              onChange={e => setOtpModal({ ...otpModal, otp: e.target.value.replace(/\D/g, '') })}
              onKeyDown={e => { if (e.key === 'Enter' && otpModal.otp) { handleVerifyPickup(otpModal.order._id, otpModal.otp); setOtpModal({ open: false, order: null, otp: '' }); fetchOrders(true); } }} />
            {import.meta.env.DEV && otpModal.order.pickup?.pickupCode && (
              <div className="mt-4 text-center"><span className="text-xs font-semibold px-3 py-1.5 bg-gradient-to-r from-orange-100 to-amber-100 text-orange-700 rounded-lg border border-orange-200">Dev hint: {otpModal.order.pickup.pickupCode}</span></div>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setOtpModal({ open: false, order: null, otp: '' })} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-slate-600 font-medium hover:bg-slate-50 transition-all duration-300">Cancel</button>
              <button onClick={() => { handleVerifyPickup(otpModal.order._id, otpModal.otp); setOtpModal({ open: false, order: null, otp: '' }); fetchOrders(true); }} disabled={!otpModal.otp} className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl font-bold hover:shadow-lg disabled:opacity-50 transition-all duration-300">Verify</button>
            </div>
          </div>
        </div>
      )}

      {/* Details Modal */}
      {detailsModal.open && detailsModal.order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={() => setDetailsModal({ open: false, order: null })}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4 border-b pb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Order {detailsModal.order.pickup?.pickupCode || detailsModal.order.orderNumber}</h3>
                <p className="text-sm text-gray-500 mt-1">Customer: {detailsModal.order.user?.name || detailsModal.order.user?.phone || 'Guest'}</p>
              </div>
              <button onClick={() => setDetailsModal({ open: false, order: null })} className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800 border-b pb-2">Documents ({detailsModal.order.documents?.length || 0})</h4>
              {detailsModal.order.documents && detailsModal.order.documents.length > 0 ? (
                detailsModal.order.documents.map((doc, di) => {
                  const docTotalPages = doc.printingRanges?.reduce((sum, range) => {
                    const rangePages = (range.rangeEnd - range.rangeStart + 1) * (range.copies || 1);
                    return sum + rangePages;
                  }, 0) || (doc.detectedPages || 0);

                  return (
                    <div key={doc._id || di} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                      <div className="flex justify-between items-start mb-2">
                        <p className="font-bold text-gray-800 text-sm">{doc.originalName}</p>
                        <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-1 rounded-full">{docTotalPages} pages</span>
                      </div>

                      <div className="space-y-2 mt-3">
                        {doc.printingRanges?.map((range, ri) => (
                          <div key={ri} className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-medium text-gray-600">Range: {range.rangeStart}-{range.rangeEnd}</span>
                            <span className="text-gray-400">•</span>
                            <span className={`px-1.5 py-0.5 rounded font-medium ${range.colorMode === 'color' ? 'bg-pink-100 text-pink-700' : 'bg-gray-200 text-gray-700'}`}>
                              {range.colorMode === 'color' ? 'Color' : 'B&W'}
                            </span>
                            <span className="text-gray-400">•</span>
                            <span className="font-medium bg-white border px-1.5 py-0.5 rounded">{range.sides === 'double' ? '2-Sided' : '1-Sided'}</span>
                            <span className="text-gray-400">•</span>
                            <span className="font-medium bg-white border px-1.5 py-0.5 rounded">Copies: {range.copies}</span>
                            {range.pagesPerSheet > 1 && (
                              <>
                                <span className="text-gray-400">•</span>
                                <span className="font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{range.pagesPerSheet} Pages/Sheet (N-Up)</span>
                              </>
                            )}
                          </div>
                        ))}
                      </div>

                      {(detailsModal.order.additionalServices?.spiralBinding || detailsModal.order.additionalServices?.blackbook) && (
                        <div className="mt-3 pt-3 border-t border-gray-200 flex gap-2">
                          {detailsModal.order.additionalServices.spiralBinding && <span className="text-[10px] uppercase tracking-wide font-bold bg-orange-100 text-orange-700 px-2 py-1 rounded">Spiral Binding</span>}
                          {detailsModal.order.additionalServices.blackbook && <span className="text-[10px] uppercase tracking-wide font-bold bg-gray-800 text-white px-2 py-1 rounded">Blackbook</span>}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="text-gray-500 text-sm">No documents in this order</div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-gray-100 flex justify-end">
              <button onClick={() => setDetailsModal({ open: false, order: null })} className="px-5 py-2.5 bg-gray-900 text-white rounded-xl font-bold hover:bg-gray-800">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShopOrders;
