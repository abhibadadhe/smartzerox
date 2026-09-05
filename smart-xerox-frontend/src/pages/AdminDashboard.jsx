import { useState, useEffect, useCallback } from 'react';
import { adminAPI, paymentAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Store, Package, DollarSign, TrendingUp,
  Bell, Search, X, RefreshCw, CheckCircle, XCircle,
  BarChart2, AlertCircle, Wrench, Megaphone,
  Loader2, FileSpreadsheet, Calendar, Download, ChevronRight
} from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer
} from 'recharts';

// ── Status colors ─────────────────────────────────────────────────────────────
const statusColors = {
  pending_payment: 'bg-yellow-100 text-yellow-800',
  paid:            'bg-blue-100 text-blue-800',
  accepted:        'bg-indigo-100 text-indigo-800',
  printing:        'bg-purple-100 text-purple-800',
  ready:           'bg-green-100 text-green-800',
  picked_up:       'bg-gray-100 text-gray-600',
  cancelled:       'bg-red-100 text-red-700',
  rejected:        'bg-red-100 text-red-700',
  expired:         'bg-orange-100 text-orange-700',
};

// ── Chart colors ─────────────────────────────────────────────────────────────
const CHART_COLORS = ['#f97316','#3b82f6','#8b5cf6','#10b981','#ef4444','#f59e0b','#6b7280','#ec4899'];

// ── Custom Tooltip ────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label, prefix = '', suffix = '' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-background shadow-lg p-3 text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-medium">
          {p.name}: {prefix}{typeof p.value === 'number' ? p.value.toLocaleString('en-IN') : p.value}{suffix}
        </p>
      ))}
    </div>
  );
};

// ── Pie Custom Label ──────────────────────────────────────────────────────────
const PieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) => {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight="bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const AdminDashboard = () => {
  // Core data
  const [stats, setStats]             = useState({});
  const [recentOrders, setRecentOrders] = useState([]);
  const [users, setUsers]             = useState([]);
  const [shops, setShops]             = useState([]);
  const [orders, setOrders]           = useState([]);
  const [analytics, setAnalytics]     = useState(null);
  const [revenue, setRevenue]         = useState(null);
  const [loading, setLoading]         = useState(true);

  // UI state
  const [activeTab, setActiveTab]     = useState('overview');

  // Users tab
  const [userSearch, setUserSearch]   = useState('');
  const [userRole, setUserRole]       = useState('');
  // Settlement Report tab
  const [settlementData, setSettlementData] = useState(null);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [selectedShopFilter, setSelectedShopFilter] = useState('all');
  const [drilldownShop, setDrilldownShop] = useState(null);

  const fetchSettlementReport = useCallback(async () => {
    setSettlementLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedShopFilter && selectedShopFilter !== 'all') params.append('shopId', selectedShopFilter);
      params.append('month', 'last_month');

      const res = await adminAPI.getSettlementReport(params.toString());
      setSettlementData(res.data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load settlement report');
    } finally {
      setSettlementLoading(false);
    }
  }, [selectedShopFilter]);

  useEffect(() => {
    if (activeTab === 'settlement') {
      fetchSettlementReport();
    }
  }, [activeTab, fetchSettlementReport]);

  const exportSettlementCSV = () => {
    if (!settlementData || !settlementData.shops) {
      toast.error('No data to export');
      return;
    }

    const rows = [
      ['Shop Name', 'Owner Name', 'Owner Phone', 'Total Orders', 'Total Gross Revenue (INR)', 'Total Docs/Pages', 'Orders > 5 Pages', 'Direct Admin Fee (INR - Online ₹1)', 'Commission Due from Shop (INR)', 'Total Admin Revenue (INR)', 'Shop Earnings (INR - 100%)']
    ];

    settlementData.shops.forEach(s => {
      rows.push([
        `"${s.shopName}"`,
        `"${s.ownerName}"`,
        `"${s.ownerPhone}"`,
        s.totalOrders,
        s.totalRevenue,
        s.totalOrderPages || s.totalDocs,
        s.docsOver5Pages,
        s.adminDirectFees || 0,
        s.adminCommissionDue || 0,
        s.adminMarginReceivable || 0,
        s.shopNetRevenue
      ]);
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Shop_Settlement_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Downloaded Settlement CSV Report!');
  };


  // Orders tab
  const [orderStatus, setOrderStatus] = useState('');
  const [orderFrom, setOrderFrom]     = useState('');
  const [orderTo, setOrderTo]         = useState('');

  // Shops tab
  const [rejectModal, setRejectModal] = useState(null);
  const [createShopModal, setCreateShopModal] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState(null);
  const [shopFormData, setShopFormData] = useState({
    shopName: '',
    ownerName: '',
    email: '',
    phone: '',
    password: '',
    street: '',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
    razorpayAccountId: '',
    bwSingleSided: 2,
    bwDoubleSided: 3,
    colorSingleSided: 10,
    colorDoubleSided: 15
  });
  const [creatingShop, setCreatingShop] = useState(false); // { id, name }
  const [rejectReason, setRejectReason] = useState('');

  // Revenue tab
  const [revenueGroup, setRevenueGroup] = useState('day');

  // Settings tab
  const [margin, setMargin]           = useState('');
  const [selectedShopId, setSelectedShopId] = useState('');

  // Commission settings
  const [commissionRate, setCommissionRate]   = useState('');
  const [commissionLabel, setCommissionLabel] = useState('');
  const [commissionLoading, setCommissionLoading] = useState(false);

  // Broadcast tab
  const [broadcastTitle, setBroadcastTitle]   = useState('');
  const [broadcastMsg, setBroadcastMsg]       = useState('');
  const [broadcastRole, setBroadcastRole]     = useState('');
  const [broadcasting, setBroadcasting]       = useState(false);

  // System Announcement & Maintenance Mode
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [systemAnnouncement, setSystemAnnouncement] = useState('');
  const [announcementType, setAnnouncementType] = useState('maintenance');
  const [announcementLoading, setAnnouncementLoading] = useState(false);

  // Refund modal
  const [refundModal, setRefundModal] = useState(null); // order object

  // ── Fetch core data ──────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const [dashRes, usersRes, shopsRes, ordersRes] = await Promise.all([
        adminAPI.getDashboard().catch(() => ({ data: {} })),
        adminAPI.getUsers().catch(() => ({ data: {} })),
        adminAPI.getShops().catch(() => ({ data: {} })),
        adminAPI.getOrders().catch(() => ({ data: {} })),
      ]);
      const dashData = dashRes.data?.data || {};
      setStats(dashData.stats || {});
      setRecentOrders(Array.isArray(dashData.recentOrders) ? dashData.recentOrders : []);
      const ud = usersRes.data?.data || {};
      setUsers(Array.isArray(ud.users) ? ud.users : []);
      const sd = shopsRes.data?.data || {};
      setShops(Array.isArray(sd.shops) ? sd.shops : []);
      const od = ordersRes.data?.data || {};
      setOrders(Array.isArray(od.orders) ? od.orders : []);
    } catch (err) { console.error('Admin fetch error:', err); }
    setLoading(false);
  }, []);

  // ── Fetch analytics ──────────────────────────────────────────────────────────
  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await adminAPI.getAnalytics();
      setAnalytics(res.data?.data || null);
    } catch { /* silent */ }
  }, []);

  // ── Fetch revenue ────────────────────────────────────────────────────────────
  const fetchRevenue = useCallback(async () => {
    try {
      const res = await adminAPI.getRevenue();
      setRevenue(res.data?.data || null);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    if (activeTab === 'analytics') fetchAnalytics();
    if (activeTab === 'revenue') fetchRevenue();
    if (activeTab === 'settings') {
      adminAPI.getCommission().then(res => {
        const d = res.data?.data || {};
        setCommissionRate(String(d.defaultCommissionRate ?? 10));
        setCommissionLabel(d.commissionLabel || 'Platform Commission');
      }).catch(() => {});

      adminAPI.getAnnouncement().then(res => {
        const d = res.data?.data || {};
        setMaintenanceMode(Boolean(d.maintenanceMode));
        setSystemAnnouncement(d.systemAnnouncement || '');
        setAnnouncementType(d.announcementType || 'maintenance');
      }).catch(() => {});
    }
  }, [activeTab, fetchAnalytics, fetchRevenue]);


  const handleUpdateAnnouncement = async () => {
    setAnnouncementLoading(true);
    try {
      await adminAPI.updateAnnouncement({
        maintenanceMode,
        systemAnnouncement,
        announcementType,
        sendNotification: true,
      });
      toast.success('📢 Broadcast announcement sent to all users successfully! ✅');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send broadcast announcement');
    } finally {
      setAnnouncementLoading(false);
    }
  };

  const handleTurnOffAnnouncement = async () => {
    setAnnouncementLoading(true);
    try {
      setMaintenanceMode(false);
      setSystemAnnouncement('');
      await adminAPI.updateAnnouncement({
        maintenanceMode: false,
        systemAnnouncement: '',
        announcementType: 'info',
        sendNotification: false,
      });
      toast.success('🔴 Maintenance & Announcement turned OFF successfully! ✅');
    } catch (err) {
      toast.error('Failed to turn off announcement');
    } finally {
      setAnnouncementLoading(false);
    }
  };

  // ── Search users ─────────────────────────────────────────────────────────────
  const handleSearchUsers = async () => {
    try {
      const params = new URLSearchParams();
      if (userSearch) params.set('search', userSearch);
      if (userRole) params.set('role', userRole);
      const res = await adminAPI.getUsers(params.toString());
      const ud = res.data?.data || {};
      setUsers(Array.isArray(ud.users) ? ud.users : []);
    } catch { toast.error('Search failed'); }
  };

  // ── Filter orders ─────────────────────────────────────────────────────────────
  const handleFilterOrders = async () => {
    try {
      const params = new URLSearchParams();
      if (orderStatus) params.set('status', orderStatus);
      if (orderFrom)   params.set('from', orderFrom);
      if (orderTo)     params.set('to', orderTo);
      const res = await adminAPI.getOrders(params.toString());
      const od = res.data?.data || {};
      setOrders(Array.isArray(od.orders) ? od.orders : []);
    } catch { toast.error('Filter failed'); }
  };

  // ── Approve shop ─────────────────────────────────────────────────────────────
  const handleApproveShop = async (id) => {
    try {
      await adminAPI.verifyShop(id, { approve: true });
      toast.success('Shop approved ✅');
      fetchData();
    } catch { toast.error('Failed to approve shop'); }
  };

  // ── Reject shop ──────────────────────────────────────────────────────────────
  const handleCreateShopWithCredentials = async (e) => {
    e.preventDefault();
    if (!shopFormData.shopName || !shopFormData.ownerName || !shopFormData.email || !shopFormData.phone || !shopFormData.password) {
      toast.error('Please fill in all required fields (Shop Name, Owner Name, Email, Phone, Password)');
      return;
    }
    setCreatingShop(true);
    try {
      const res = await adminAPI.createShopWithCredentials(shopFormData);
      toast.success(res.data.message || 'Shop created successfully!');
      setCreatedCredentials(res.data.data.credentials);
      fetchShops();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to create shop');
    } finally {
      setCreatingShop(false);
    }
  };

  const handleRejectShop = async () => {
    if (!rejectReason.trim()) { toast.error('Please enter a reason'); return; }
    try {
      await adminAPI.verifyShop(rejectModal.id, { approve: false, reason: rejectReason });
      toast.success('Shop rejected');
      setRejectModal(null);
      setRejectReason('');
      fetchData();
    } catch { toast.error('Failed to reject shop'); }
  };

  // ── Block / unblock user ──────────────────────────────────────────────────────
  const handleBlockUser = async (id) => {
    try {
      await adminAPI.toggleUser(id);
      toast.success('User status updated');
      fetchData();
    } catch { toast.error('Failed to update user'); }
  };

  // ── Set margin ────────────────────────────────────────────────────────────────
  const handleMargin = async () => {
    if (!selectedShopId) { toast.error('Select a shop first'); return; }
    try {
      await adminAPI.setMargin(selectedShopId, { margin: Number(margin) });
      toast.success('Margin updated ✅');
      fetchData();
    } catch { toast.error('Failed to update margin'); }
  };

  // ── Update global commission ──────────────────────────────────────────────────
  const handleUpdateCommission = async () => {
    const rate = Number(commissionRate);
    if (isNaN(rate) || rate < 0 || rate > 100) { toast.error('Rate must be 0–100'); return; }
    setCommissionLoading(true);
    try {
      await adminAPI.updateCommission({ defaultCommissionRate: rate, commissionLabel });
      toast.success(`Global commission set to ${rate}% ✅`);
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to update commission'); }
    setCommissionLoading(false);
  };

  // ── Apply global commission to all shops ──────────────────────────────────────
  const handleApplyToAll = async (overrideExisting) => {
    setCommissionLoading(true);
    try {
      const res = await adminAPI.applyCommissionToAll({ overrideExisting });
      toast.success(res.data?.message || 'Applied ✅');
      fetchData();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to apply'); }
    setCommissionLoading(false);
  };

  // ── Broadcast ─────────────────────────────────────────────────────────────────
  const handleBroadcast = async () => {
    if (!broadcastTitle || !broadcastMsg) { toast.error('Fill in title and message'); return; }
    setBroadcasting(true);
    try {
      const res = await adminAPI.broadcast({ title: broadcastTitle, message: broadcastMsg, targetRole: broadcastRole || undefined });
      toast.success(`Sent to ${res.data?.data?.sentTo || '?'} users ✅`);
      setBroadcastTitle(''); setBroadcastMsg(''); setBroadcastRole('');
    } catch { toast.error('Broadcast failed'); }
    setBroadcasting(false);
  };

  // ── Refund ────────────────────────────────────────────────────────────────────
  const handleRefund = async () => {
    try {
      await paymentAPI.refund({ orderId: refundModal._id, reason: 'Admin initiated refund' });
      toast.success('Refund initiated ✅');
      setRefundModal(null);
      fetchData();
    } catch (err) { toast.error(err.response?.data?.message || 'Refund failed'); }
  };

  // ── Fetch revenue with groupBy ────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'revenue') {
      adminAPI.getRevenue(`groupBy=${revenueGroup}`).then(res => {
        setRevenue(res.data?.data || null);
      }).catch(() => {});
    }
  }, [revenueGroup, activeTab]);

  const statCards = [
    { icon: Users,      label: 'Total Users',   value: stats.totalUsers   || 0,  color: 'text-blue-500'   },
    { icon: Store,      label: 'Total Shops',   value: stats.totalShops   || 0,  color: 'text-green-500'  },
    { icon: Package,    label: 'Total Orders',  value: stats.totalOrders  || 0,  color: 'text-primary'    },
    { icon: DollarSign, label: 'Revenue (MTD)', value: `₹${stats.monthPlatformRevenue || 0}`, color: 'text-orange-500' },
  ];

  const tabs = [
    { id: 'overview',   label: '📊 Overview'   },
    { id: 'settlement', label: '📑 Monthly Closure & Settlement' },
    { id: 'analytics',  label: '📈 Analytics'  },
    { id: 'revenue',    label: '💰 Revenue'    },
    { id: 'users',      label: '👥 Users'      },
    { id: 'shops',      label: '🏪 Shops'      },
    { id: 'orders',     label: '📦 Orders'     },
    { id: 'broadcast',  label: '📢 Broadcast'  },
    { id: 'settings',   label: '⚙️ Settings'   },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="font-heading text-3xl font-bold">Admin Panel 🔐</h1>
          <p className="text-muted-foreground">Platform management, analytics & controls</p>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${activeTab === t.id ? 'sunrise-gradient text-primary-foreground sunrise-shadow-sm' : 'bg-secondary text-secondary-foreground'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {statCards.map((s, i) => (
                <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="glass-card p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
                      <s.icon className={`h-5 w-5 ${s.color}`} />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="font-heading text-xl font-bold">{s.value}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { label: 'Active Orders',        value: stats.activeOrders        || 0 },
                { label: "Today's Orders",       value: stats.todayOrders         || 0 },
                { label: 'Pending Verification', value: stats.pendingVerification || 0 },
              ].map((s) => (
                <div key={s.label} className="glass-card p-4 text-center">
                  <p className="text-2xl font-heading font-bold text-primary">{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            <div className="glass-card p-5">
              <h3 className="font-heading font-semibold mb-4">Recent Orders (Last 10)</h3>
              {loading ? <p className="text-sm text-muted-foreground">Loading...</p> :
               recentOrders.length === 0 ? <p className="text-sm text-muted-foreground">No orders yet</p> : (
                <div className="space-y-2">
                  {recentOrders.map((o) => (
                    <div key={o._id} className="flex items-center justify-between rounded-lg bg-secondary/50 p-3 text-sm">
                      <div>
                        <span className="font-mono text-xs font-semibold">#{o._id?.slice(-6).toUpperCase()}</span>
                        <span className="text-muted-foreground ml-2">{o.user?.name || 'User'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${statusColors[o.status] || 'bg-muted text-muted-foreground'}`}>{o.status}</span>
                        <span className="font-medium text-primary text-xs">₹{o.pricing?.total || 0}</span>
                        <span className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleDateString('en-IN')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}


        {/* ── MONTHLY CLOSURE & SETTLEMENT REPORT ── */}
        {activeTab === 'settlement' && (
          <div className="space-y-6">
            {/* 7-Day Window Notice */}
            {settlementData?.period?.isSettlementWindowActive && (
              <div className="bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-green-500/10 border-2 border-emerald-500/30 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-emerald-500 text-white rounded-xl shadow-md shrink-0">
                    <Calendar className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-heading font-bold text-emerald-950 dark:text-emerald-100 text-base">
                        🟢 7-Day Monthly Settlement Window is ACTIVE
                      </span>
                      <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 text-xs font-semibold px-2 py-0.5 rounded-full">
                        {settlementData.period.daysRemainingInWindow} days remaining
                      </span>
                    </div>
                    <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80 mt-1">
                      Monthly accounts from 1st to 30th/31st are finalized. Available for 7 days post month-end to review each shopkeeper's net revenue and complete bank/UPI payouts.
                    </p>
                  </div>
                </div>
                <Button 
                  onClick={fetchSettlementReport}
                  variant="outline"
                  className="border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-400 dark:text-emerald-300 font-semibold text-xs shrink-0"
                >
                  🔄 Refresh Settlement Report
                </Button>
              </div>
            )}

            {/* Filter & Settlement Period Bar */}
            <div className="glass-card p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground mr-1">Settlement Period:</span>
                <span className="px-3.5 py-1.5 rounded-lg text-xs font-bold sunrise-gradient text-white shadow-sm flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  {settlementData?.period?.label || 'Previous Closed Month'}
                </span>
                {settlementData?.period?.startDate && settlementData?.period?.endDate && (
                  <span className="text-xs text-muted-foreground hidden sm:inline ml-1 font-mono">
                    ({new Date(settlementData.period.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – {new Date(settlementData.period.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })})
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <select 
                  value={selectedShopFilter} 
                  onChange={e => setSelectedShopFilter(e.target.value)}
                  className="rounded-lg border border-border bg-background px-3 h-9 text-xs font-medium"
                >
                  <option value="all">All Shops ({shops.length})</option>
                  {shops.map(s => (
                    <option key={s._id} value={s._id}>{s.name}</option>
                  ))}
                </select>

                <Button 
                  onClick={fetchSettlementReport} 
                  size="sm" 
                  variant="outline" 
                  disabled={settlementLoading}
                  className="h-9 px-3"
                  title="Refresh Settlement Report"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${settlementLoading ? 'animate-spin' : ''}`} />
                </Button>

                <Button 
                  onClick={exportSettlementCSV} 
                  size="sm" 
                  className="sunrise-gradient text-white font-semibold h-9 px-3 flex items-center gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </Button>
              </div>
            </div>

            {/* Financial Summary Metric Cards */}
            {settlementData?.overallTotals && (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
                <div className="glass-card p-4 text-center">
                  <p className="text-xs text-muted-foreground font-medium mb-1">Total Gross Revenue</p>
                  <p className="font-heading text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
                    ₹{(settlementData.overallTotals.totalRevenue || 0).toLocaleString('en-IN')}
                  </p>
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">{settlementData.period?.label}</span>
                </div>

                <div className="glass-card p-4 text-center">
                  <p className="text-xs text-muted-foreground font-medium mb-1">Total Orders</p>
                  <p className="font-heading text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {(settlementData.overallTotals.totalOrders || 0).toLocaleString('en-IN')}
                  </p>
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">Completed & Paid</span>
                </div>

                <div className="glass-card p-4 text-center bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
                  <p className="text-xs text-green-800 dark:text-green-300 font-medium mb-1">Shop Total Earnings</p>
                  <p className="font-heading text-xl sm:text-2xl font-bold text-green-700 dark:text-green-400">
                    ₹{(settlementData.overallTotals.shopNetRevenue || 0).toLocaleString('en-IN')}
                  </p>
                  <span className="text-[10px] text-green-700/80 mt-0.5 block">100% Printing & Services</span>
                </div>

                <div className="glass-card p-4 text-center bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-800">
                  <p className="text-xs text-indigo-800 dark:text-indigo-300 font-medium mb-1">Direct Admin Fee (₹1/order)</p>
                  <p className="font-heading text-xl sm:text-2xl font-bold text-indigo-700 dark:text-indigo-400">
                    ₹{(settlementData.overallTotals.adminDirectFees || 0).toLocaleString('en-IN')}
                  </p>
                  <span className="text-[10px] text-indigo-700/80 mt-0.5 block">Directly in Admin Acc (&gt;5 pages)</span>
                </div>

                <div className="glass-card p-4 text-center bg-orange-50/50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800">
                  <p className="text-xs text-orange-800 dark:text-orange-300 font-medium mb-1">Commission Due from Shops</p>
                  <p className="font-heading text-xl sm:text-2xl font-bold text-orange-600 dark:text-orange-400">
                    ₹{(settlementData.overallTotals.adminCommissionDue || 0).toLocaleString('en-IN')}
                  </p>
                  <span className="text-[10px] text-orange-700/80 mt-0.5 block">Shopkeeper pays Admin manually</span>
                </div>
              </div>
            )}

            {/* Shop Breakdown Table */}
            <div className="glass-card overflow-hidden">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div>
                  <h3 className="font-heading font-semibold text-base flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-orange-500" />
                    Shop-by-Shop Settlement Breakdown ({settlementData?.period?.label})
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Click any shop to drill down and inspect individual customer orders</p>
                </div>
                {settlementData?.shops && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground">
                    {settlementData.shops.length} Shop(s)
                  </span>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 text-left font-semibold">Shop Name & Owner</th>
                      <th className="px-4 py-3 text-center font-semibold">Orders Count</th>
                      <th className="px-4 py-3 text-center font-semibold">Printed Pages</th>
                      <th className="px-4 py-3 text-right font-semibold">Customer Total</th>
                      <th className="px-4 py-3 text-right font-semibold text-green-700 dark:text-green-400">Shop Earnings (100%)</th>
                      <th className="px-4 py-3 text-right font-semibold text-indigo-700 dark:text-indigo-400">Direct Fee (₹1 Online)</th>
                      <th className="px-4 py-3 text-right font-semibold text-orange-600 dark:text-orange-400">Commission Due</th>
                      <th className="px-4 py-3 text-center font-semibold">Audit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlementLoading ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-orange-500" />
                          Loading settlement reports...
                        </td>
                      </tr>
                    ) : !settlementData?.shops?.length ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                          No settlement records found for this period.
                        </td>
                      </tr>
                    ) : settlementData.shops.map((s) => (
                      <tr key={s.shopId} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3.5">
                          <p className="font-semibold text-sm text-foreground">{s.shopName}</p>
                          <p className="text-xs text-muted-foreground">{s.ownerName} · 📞 {s.ownerPhone || 'N/A'}</p>
                        </td>
                        <td className="px-4 py-3.5 text-center font-semibold text-blue-600 dark:text-blue-400">
                          {s.totalOrders}
                        </td>
                        <td className="px-4 py-3.5 text-center text-xs text-muted-foreground">
                          {s.totalOrderPages || s.totalDocs} pages ({s.totalDocs} docs)
                        </td>
                        <td className="px-4 py-3.5 text-right font-semibold">
                          ₹{s.totalRevenue.toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3.5 text-right font-bold text-green-700 dark:text-green-400">
                          ₹{s.shopNetRevenue.toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3.5 text-right font-semibold text-indigo-700 dark:text-indigo-400">
                          ₹{(s.adminDirectFees || 0).toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3.5 text-right font-semibold text-orange-600 dark:text-orange-400">
                          ₹{(s.adminCommissionDue || 0).toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => setDrilldownShop(s)}
                            className="text-xs h-7 px-2.5 gap-1 hover:bg-orange-50 hover:text-orange-700 hover:border-orange-300"
                          >
                            🔍 {s.orders.length} Orders <ChevronRight className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Drilldown Shop Orders Modal */}
            {drilldownShop && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto" onClick={() => setDrilldownShop(null)}>
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-4xl w-full my-8 shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
                  
                  <div className="flex items-start justify-between border-b pb-3">
                    <div>
                      <h3 className="font-heading font-bold text-lg text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        📑 {drilldownShop.shopName} — Orders Breakdown ({settlementData?.period?.label})
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Owner: {drilldownShop.ownerName} · Phone: {drilldownShop.ownerPhone} · Shop Earnings: <strong className="text-green-600 font-bold">₹{drilldownShop.shopNetRevenue}</strong> · Direct Admin Fees: <strong className="text-indigo-600 font-bold">₹{drilldownShop.adminDirectFees || 0}</strong> · Commission Due: <strong className="text-orange-600 font-bold">₹{drilldownShop.adminCommissionDue || 0}</strong>
                      </p>
                    </div>
                    <button type="button" onClick={() => setDrilldownShop(null)}><X className="h-5 w-5 text-slate-400" /></button>
                  </div>

                  <div className="max-h-[60vh] overflow-y-auto pr-1">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-secondary/50 text-muted-foreground text-left">
                          <th className="p-2.5 font-semibold">Order #</th>
                          <th className="p-2.5 font-semibold">Customer</th>
                          <th className="p-2.5 font-semibold text-center">Pages</th>
                          <th className="p-2.5 font-semibold text-right">Customer Total</th>
                          <th className="p-2.5 font-semibold text-right text-indigo-700 dark:text-indigo-400">Direct Fee (₹1)</th>
                          <th className="p-2.5 font-semibold text-right text-orange-600 dark:text-orange-400">Commission Due</th>
                          <th className="p-2.5 font-semibold text-right text-green-600 dark:text-green-400">Shop Receivable</th>
                          <th className="p-2.5 font-semibold text-center">Status</th>
                          <th className="p-2.5 font-semibold">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drilldownShop.orders.map(o => (
                          <tr key={o.orderId} className="border-b border-border/40 hover:bg-secondary/20">
                            <td className="p-2.5 font-mono font-bold">#{o.orderNumber || o.orderId.slice(-6).toUpperCase()}</td>
                            <td className="p-2.5">
                              <p className="font-medium">{o.customerName}</p>
                              <p className="text-[10px] text-muted-foreground">{o.customerPhone}</p>
                            </td>
                            <td className="p-2.5 text-center font-medium">{o.totalOrderPages || o.totalDocs}</td>
                            <td className="p-2.5 text-right font-semibold">₹{o.totalAmount}</td>
                            <td className="p-2.5 text-right font-medium text-indigo-600 dark:text-indigo-400">₹{o.pageFee || (o.totalOrderPages > 5 ? 1 : 0)}</td>
                            <td className="p-2.5 text-right font-medium text-orange-600">₹{o.percentCommission || 0}</td>
                            <td className="p-2.5 text-right font-bold text-green-600">₹{o.shopReceivable}</td>
                            <td className="p-2.5 text-center">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] ${statusColors[o.status] || 'bg-muted text-muted-foreground'}`}>
                                {o.status}
                              </span>
                            </td>
                            <td className="p-2.5 text-muted-foreground">{new Date(o.createdAt).toLocaleDateString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end pt-3 border-t">
                    <Button variant="outline" size="sm" onClick={() => setDrilldownShop(null)}>Close</Button>
                  </div>
                </motion.div>
              </div>
            )}
          </div>
        )}

        {/* ── ANALYTICS ── */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {!analytics ? (
              <div className="glass-card p-8 text-center text-muted-foreground">Loading analytics...</div>
            ) : (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  {/* Orders by Status — Pie Chart */}
                  <div className="glass-card p-5">
                    <h3 className="font-heading font-semibold mb-4 flex items-center gap-2">
                      <BarChart2 className="h-4 w-4 text-primary" /> Orders by Status
                    </h3>
                    {analytics.ordersByStatus?.length > 0 ? (
                      <>
                        <ResponsiveContainer width="100%" height={220}>
                          <PieChart>
                            <Pie
                              data={analytics.ordersByStatus}
                              dataKey="count"
                              nameKey="_id"
                              cx="50%"
                              cy="50%"
                              outerRadius={90}
                              labelLine={false}
                              label={PieLabel}
                            >
                              {analytics.ordersByStatus.map((_, i) => (
                                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                        {/* Legend */}
                        <div className="grid grid-cols-2 gap-1 mt-2">
                          {analytics.ordersByStatus.map((d, i) => (
                            <div key={d._id} className="flex items-center gap-2 text-xs">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                              <span className="capitalize text-muted-foreground truncate">{d._id?.replace(/_/g, ' ')}</span>
                              <span className="font-semibold ml-auto">{d.count}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8">No order data yet</p>
                    )}
                  </div>

                  {/* Top Shops — Horizontal Bar Chart */}
                  <div className="glass-card p-5">
                    <h3 className="font-heading font-semibold mb-4 flex items-center gap-2">
                      <Store className="h-4 w-4 text-green-500" /> Top Shops by Orders
                    </h3>
                    {analytics.topShops?.length > 0 ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart
                          data={analytics.topShops}
                          layout="vertical"
                          margin={{ left: 0, right: 20 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                          <XAxis type="number" tick={{ fontSize: 11 }} />
                          <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                          <Tooltip content={<CustomTooltip suffix=" orders" />} />
                          <Bar dataKey="totalOrders" name="Orders" radius={[0, 6, 6, 0]}>
                            {analytics.topShops.map((_, i) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8">No shop data yet</p>
                    )}
                  </div>
                </div>

                {/* Order Trend — Area Chart */}
                <div className="glass-card p-5">
                  <h3 className="font-heading font-semibold mb-4 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-blue-500" /> Order Trend — Last 30 Days
                  </h3>
                  {analytics.orderTrend?.length > 0 ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={analytics.orderTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <defs>
                          <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="_id" tick={{ fontSize: 11 }} tickFormatter={v => v?.slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip content={<CustomTooltip suffix=" orders" />} />
                        <Area
                          type="monotone"
                          dataKey="count"
                          name="Orders"
                          stroke="#3b82f6"
                          strokeWidth={2.5}
                          fill="url(#colorOrders)"
                          dot={{ r: 4, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }}
                          activeDot={{ r: 6 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">No trend data yet</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── REVENUE ── */}
        {activeTab === 'revenue' && (
          <div className="space-y-6">
            {/* Group by selector */}
            <div className="glass-card p-4 flex items-center gap-4">
              <Label className="shrink-0">Group by:</Label>
              <div className="flex gap-2">
                {['day', 'week', 'month'].map((g) => (
                  <button key={g} onClick={() => setRevenueGroup(g)}
                    className={`rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition-all ${revenueGroup === g ? 'sunrise-gradient text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* Stat cards */}
            {revenue?.totals && (
              <div className="grid gap-4 sm:grid-cols-4">
                {[
                  { label: 'Total Revenue',    value: `₹${(revenue.totals.totalRevenue    || 0).toLocaleString('en-IN')}`, color: 'text-primary'    },
                  { label: 'Platform Revenue', value: `₹${(revenue.totals.platformRevenue || 0).toLocaleString('en-IN')}`, color: 'text-orange-500' },
                  { label: 'Shop Revenue',     value: `₹${(revenue.totals.shopRevenue     || 0).toLocaleString('en-IN')}`, color: 'text-green-500'  },
                  { label: 'Total Orders',     value: revenue.totals.orderCount || 0,                                      color: 'text-blue-500'   },
                ].map((s) => (
                  <div key={s.label} className="glass-card p-4 text-center">
                    <p className={`font-heading text-2xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Total Revenue — Area Chart */}
            <div className="glass-card p-5">
              <h3 className="font-heading font-semibold mb-1 flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-primary" /> Total Revenue by {revenueGroup}
              </h3>
              <p className="text-xs text-muted-foreground mb-4">Overall platform + shop revenue combined</p>
              {!revenue?.revenue?.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">No revenue data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={revenue.revenue} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradShop" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="_id" tick={{ fontSize: 11 }} tickFormatter={v => revenueGroup === 'day' ? v?.slice(5) : v} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${v}`} />
                    <Tooltip content={<CustomTooltip prefix="₹" />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="totalRevenue" name="Total Revenue" stroke="#f97316" strokeWidth={2.5} fill="url(#gradTotal)" dot={{ r: 3 }} />
                    <Area type="monotone" dataKey="shopRevenue" name="Shop Revenue" stroke="#10b981" strokeWidth={2} fill="url(#gradShop)" dot={{ r: 3 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Revenue Breakdown — Grouped Bar Chart */}
            {revenue?.revenue?.length > 0 && (
              <div className="glass-card p-5">
                <h3 className="font-heading font-semibold mb-1 flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-purple-500" /> Revenue Breakdown
                </h3>
                <p className="text-xs text-muted-foreground mb-4">Platform margin vs shop receivable per period</p>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={revenue.revenue} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="_id" tick={{ fontSize: 11 }} tickFormatter={v => revenueGroup === 'day' ? v?.slice(5) : v} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${v}`} />
                    <Tooltip content={<CustomTooltip prefix="₹" />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="platformRevenue" name="Platform Margin" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="shopRevenue" name="Shop Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Orders per period */}
            {revenue?.revenue?.length > 0 && (
              <div className="glass-card p-5">
                <h3 className="font-heading font-semibold mb-1 flex items-center gap-2">
                  <Package className="h-4 w-4 text-blue-500" /> Orders per Period
                </h3>
                <p className="text-xs text-muted-foreground mb-4">Number of paid orders by {revenueGroup}</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={revenue.revenue} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="_id" tick={{ fontSize: 11 }} tickFormatter={v => revenueGroup === 'day' ? v?.slice(5) : v} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip suffix=" orders" />} />
                    <Bar dataKey="orderCount" name="Orders" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ── USERS ── */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            {/* Search & filter */}
            <div className="glass-card p-4 flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-48">
                <Label className="text-xs">Search</Label>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Name, email or phone..." value={userSearch} onChange={e => setUserSearch(e.target.value)} className="pl-8 h-9 text-sm" onKeyDown={e => e.key === 'Enter' && handleSearchUsers()} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Role</Label>
                <select value={userRole} onChange={e => setUserRole(e.target.value)} className="mt-1 rounded-lg border border-border bg-background px-3 h-9 text-sm">
                  <option value="">All roles</option>
                  <option value="user">User</option>
                  <option value="shopkeeper">Shopkeeper</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <Button onClick={handleSearchUsers} size="sm" className="sunrise-gradient text-primary-foreground">
                <Search className="h-3.5 w-3.5 mr-1" /> Search
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setUserSearch(''); setUserRole(''); fetchData(); }}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reset
              </Button>
            </div>

            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/50">
                      <th className="px-4 py-3 text-left font-medium">Name</th>
                      <th className="px-4 py-3 text-left font-medium">Email</th>
                      <th className="px-4 py-3 text-left font-medium">Phone</th>
                      <th className="px-4 py-3 text-left font-medium">Role</th>
                      <th className="px-4 py-3 text-left font-medium">Verified</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-left font-medium">Joined</th>
                      <th className="px-4 py-3 text-left font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No users found</td></tr>
                    ) : users.map((u) => (
                      <tr key={u._id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3 font-medium">{u.name}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{u.email}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{u.phone}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs capitalize font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : u.role === 'shopkeeper' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {u.isEmailVerified
                            ? <span className="text-green-600 text-xs flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Email</span>
                            : <span className="text-red-500 text-xs flex items-center gap-1"><XCircle className="h-3 w-3" /> Unverified</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {u.isActive ? 'Active' : 'Blocked'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString('en-IN')}</td>
                        <td className="px-4 py-3">
                          {u.role !== 'admin' && (
                            <Button variant="ghost" size="sm" onClick={() => handleBlockUser(u._id)}
                              className={u.isActive ? 'text-destructive text-xs' : 'text-green-600 text-xs'}>
                              {u.isActive ? 'Block' : 'Unblock'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground p-3 border-t border-border">{users.length} users shown</p>
            </div>
          </div>
        )}

        {/* ── SHOPS ── */}
        {activeTab === 'shops' && (
          <div className="space-y-4">
            {/* ── HEADER ACTION BAR WITH ADD SHOP BUTTON ── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-card p-5 rounded-2xl border-2 border-orange-200/80 bg-gradient-to-r from-orange-50/70 via-background to-amber-50/50 shadow-md mb-4">
              <div>
                <h3 className="font-heading font-bold text-lg text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  🏬 Xerox Shops Directory
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">Manage existing xerox shops & onboard new shopkeeper accounts directly</p>
              </div>
              <Button 
                onClick={() => { setCreatedCredentials(null); setCreateShopModal(true); }} 
                className="sunrise-gradient text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow-lg shadow-orange-500/20 hover:scale-105 transition-all shrink-0"
              >
                + Add Shop & Handover Credentials
              </Button>
            </div>
            {shops.length === 0 ? (
              <div className="glass-card p-8 text-center text-muted-foreground">No shops found</div>
            ) : shops.map((s) => (
              <div key={s._id} className="glass-card p-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold">{s.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.isVerified ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {s.isVerified ? '✓ Verified' : '⏳ Pending'}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${s.isOpen ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                        {s.isOpen ? 'Open' : 'Closed'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{s.address?.street}, {s.address?.city}, {s.address?.state}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.phone} · {s.email}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Owner: {s.owner?.name || 'N/A'} · Rating: ⭐ {s.rating || 0} · Orders: {s.totalOrders || 0}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      B&W: ₹{s.pricing?.bw?.singleSided || 0}/page · Color: ₹{s.pricing?.color?.singleSided || 0}/page · Margin: {s.platformMargin || 0}%
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {!s.isVerified && (
                      <>
                        <Button size="sm" className="sunrise-gradient text-primary-foreground" onClick={() => handleApproveShop(s._id)}>
                          <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive border-destructive" onClick={() => setRejectModal({ id: s._id, name: s.name })}>
                          <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                        </Button>
                      </>
                    )}
                    {s.isVerified && (
                      <Button size="sm" variant="outline" className="text-destructive border-destructive" onClick={() => setRejectModal({ id: s._id, name: s.name })}>
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}


            {/* ── CREATE SHOP & CREDENTIALS HANDOVER MODAL ── */}
            {createShopModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto" onClick={() => setCreateShopModal(false)}>
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-xl w-full my-8 shadow-2xl" onClick={e => e.stopPropagation()}>
                  
                  {!createdCredentials ? (
                    <form onSubmit={handleCreateShopWithCredentials} className="space-y-4">
                      <div className="flex items-center justify-between border-b pb-3">
                        <h3 className="font-heading font-bold text-lg text-slate-900 dark:text-slate-100 flex items-center gap-2">
                          🏬 Add New Shop & Create Credentials
                        </h3>
                        <button type="button" onClick={() => setCreateShopModal(false)}><X className="h-5 w-5 text-slate-400" /></button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs font-semibold">Shop Name *</Label>
                          <Input required placeholder="e.g. Agrawal Xerox Center" value={shopFormData.shopName} onChange={e => setShopFormData({...shopFormData, shopName: e.target.value})} className="mt-1" />
                        </div>
                        <div>
                          <Label className="text-xs font-semibold">Owner Full Name *</Label>
                          <Input required placeholder="e.g. Sanket Jadhav" value={shopFormData.ownerName} onChange={e => setShopFormData({...shopFormData, ownerName: e.target.value})} className="mt-1" />
                        </div>
                        <div>
                          <Label className="text-xs font-semibold">Login Email (ID) *</Label>
                          <Input required type="email" placeholder="e.g. sanket@gmail.com" value={shopFormData.email} onChange={e => setShopFormData({...shopFormData, email: e.target.value})} className="mt-1" />
                        </div>
                        <div>
                          <Label className="text-xs font-semibold">Login Password *</Label>
                          <Input required placeholder="e.g. agrawal@123" value={shopFormData.password} onChange={e => setShopFormData({...shopFormData, password: e.target.value})} className="mt-1" />
                        </div>
                        <div>
                          <Label className="text-xs font-semibold">Phone Number *</Label>
                          <Input required placeholder="e.g. 9876543210" value={shopFormData.phone} onChange={e => setShopFormData({...shopFormData, phone: e.target.value})} className="mt-1" />
                        </div>
                        <div>
                          <Label className="text-xs font-semibold">Razorpay Account ID (Optional)</Label>
                          <Input placeholder="e.g. acc_Hk82b7xZ91" value={shopFormData.razorpayAccountId} onChange={e => setShopFormData({...shopFormData, razorpayAccountId: e.target.value})} className="mt-1" />
                        </div>
                      </div>

                      <div className="border-t pt-3 space-y-2">
                        <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Shop Address</Label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          <Input placeholder="Street Address" value={shopFormData.street} onChange={e => setShopFormData({...shopFormData, street: e.target.value})} />
                          <Input placeholder="City" value={shopFormData.city} onChange={e => setShopFormData({...shopFormData, city: e.target.value})} />
                          <Input placeholder="Pincode" value={shopFormData.pincode} onChange={e => setShopFormData({...shopFormData, pincode: e.target.value})} />
                        </div>
                      </div>

                      <div className="border-t pt-3 space-y-2">
                        <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Pricing Rates (₹ per page)</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <div><span className="text-[11px] text-muted-foreground">B&W 1-Side</span><Input type="number" step="0.5" value={shopFormData.bwSingleSided} onChange={e => setShopFormData({...shopFormData, bwSingleSided: e.target.value})} /></div>
                          <div><span className="text-[11px] text-muted-foreground">B&W 2-Side (Sheet)</span><Input type="number" step="0.5" value={shopFormData.bwDoubleSided} onChange={e => setShopFormData({...shopFormData, bwDoubleSided: e.target.value})} /></div>
                        </div>
                      </div>

                      <div className="flex gap-2 pt-4 border-t">
                        <Button type="submit" disabled={creatingShop} className="flex-1 sunrise-gradient text-white font-medium">
                          {creatingShop ? 'Creating Shop Account...' : '✨ Create Shop & Generate Handover Credentials'}
                        </Button>
                        <Button type="button" variant="outline" onClick={() => setCreateShopModal(false)}>Cancel</Button>
                      </div>
                    </form>
                  ) : (
                    /* ── HANDOVER CREDENTIALS CARD ── */
                    <div className="space-y-4 text-center">
                      <div className="w-12 h-12 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto">
                        <CheckCircle className="h-6 w-6" />
                      </div>
                      <h3 className="font-heading font-bold text-xl text-slate-900 dark:text-slate-100">
                        🎉 Shop Created Successfully!
                      </h3>
                      <p className="text-xs text-muted-foreground">Copy these credentials and hand them over directly to the shopkeeper:</p>

                      <div className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-left font-mono text-xs space-y-2 select-all">
                        <p><strong>🏬 Shop Name:</strong> {shopFormData.shopName}</p>
                        <p><strong>👤 Owner Name:</strong> {createdCredentials.ownerName}</p>
                        <p><strong>📧 Login Email (ID):</strong> {createdCredentials.email}</p>
                        <p><strong>🔑 Password:</strong> {createdCredentials.password}</p>
                        <p><strong>🔗 Login URL:</strong> {createdCredentials.loginUrl}</p>
                      </div>

                      <div className="flex gap-2 pt-2">
                        <Button className="flex-1 sunrise-gradient text-white font-semibold" onClick={() => {
                          const text = `🏬 SMART XEROX SHOPKEEPER LOGIN\n\nShop: ${shopFormData.shopName}\nOwner: ${createdCredentials.ownerName}\nEmail: ${createdCredentials.email}\nPassword: ${createdCredentials.password}\nLogin URL: ${createdCredentials.loginUrl}`;
                          navigator.clipboard.writeText(text);
                          toast.success('Credentials copied to clipboard!');
                        }}>
                          📋 Copy Credentials for WhatsApp
                        </Button>
                        <Button variant="outline" onClick={() => { setCreateShopModal(false); setCreatedCredentials(null); }}>Done</Button>
                      </div>
                    </div>
                  )}
                </motion.div>
              </div>
            )}

            {/* Reject modal */}
            {rejectModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm p-4" onClick={() => setRejectModal(null)}>
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  className="glass-card p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-heading font-semibold flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-destructive" /> Reject / Revoke Shop
                    </h3>
                    <button onClick={() => setRejectModal(null)}><X className="h-4 w-4" /></button>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">Rejecting: <strong>{rejectModal.name}</strong></p>
                  <div>
                    <Label>Reason (required)</Label>
                    <textarea
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="e.g. Documents incomplete, invalid address..."
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm min-h-[80px]"
                    />
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button className="flex-1 bg-destructive text-destructive-foreground" onClick={handleRejectShop}>Confirm Reject</Button>
                    <Button variant="outline" onClick={() => setRejectModal(null)}>Cancel</Button>
                  </div>
                </motion.div>
              </div>
            )}
          </div>
        )}

        {/* ── ORDERS ── */}
        {activeTab === 'orders' && (
          <div className="space-y-4">
            {/* Filter bar */}
            <div className="glass-card p-4 flex flex-wrap gap-3 items-end">
              <div>
                <Label className="text-xs">Status</Label>
                <select value={orderStatus} onChange={e => setOrderStatus(e.target.value)} className="mt-1 rounded-lg border border-border bg-background px-3 h-9 text-sm">
                  <option value="">All statuses</option>
                  {['pending_payment','paid','accepted','printing','ready','picked_up','cancelled','rejected','expired'].map(s => (
                    <option key={s} value={s}>{s.replace('_',' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">From Date</Label>
                <Input type="date" value={orderFrom} onChange={e => setOrderFrom(e.target.value)} className="mt-1 h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs">To Date</Label>
                <Input type="date" value={orderTo} onChange={e => setOrderTo(e.target.value)} className="mt-1 h-9 text-sm" />
              </div>
              <Button onClick={handleFilterOrders} size="sm" className="sunrise-gradient text-primary-foreground">Apply Filter</Button>
              <Button variant="outline" size="sm" onClick={() => { setOrderStatus(''); setOrderFrom(''); setOrderTo(''); fetchData(); }}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reset
              </Button>
            </div>

            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/50">
                      <th className="px-4 py-3 text-left font-medium">Order ID</th>
                      <th className="px-4 py-3 text-left font-medium">User</th>
                      <th className="px-4 py-3 text-left font-medium">Shop</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-left font-medium">Total</th>
                      <th className="px-4 py-3 text-left font-medium">Date</th>
                      <th className="px-4 py-3 text-left font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No orders found</td></tr>
                    ) : orders.map((o) => (
                      <tr key={o._id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs font-semibold">#{o._id?.slice(-6).toUpperCase()}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-xs">{o.user?.name || '-'}</p>
                          <p className="text-muted-foreground text-xs">{o.user?.email}</p>
                        </td>
                        <td className="px-4 py-3 text-xs">{o.shop?.name || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${statusColors[o.status] || 'bg-muted text-muted-foreground'}`}>
                            {o.status?.replace('_',' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-primary">₹{o.pricing?.total || 0}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleDateString('en-IN')}</td>
                        <td className="px-4 py-3">
                          {['rejected','cancelled','expired'].includes(o.status) && o.payment?.status === 'paid' && (
                            <Button size="sm" variant="outline" className="text-xs text-blue-600 border-blue-200" onClick={() => setRefundModal(o)}>
                              💸 Refund
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground p-3 border-t border-border">{orders.length} orders shown</p>
            </div>

            {/* Refund modal */}
            {refundModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm p-4" onClick={() => setRefundModal(null)}>
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  className="glass-card p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-heading font-semibold">Initiate Refund</h3>
                    <button onClick={() => setRefundModal(null)}><X className="h-4 w-4" /></button>
                  </div>
                  <div className="space-y-2 text-sm mb-6">
                    <div className="flex justify-between"><span className="text-muted-foreground">Order</span><span className="font-mono">#{refundModal._id?.slice(-6).toUpperCase()}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">User</span><span>{refundModal.user?.name}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-bold text-primary">₹{refundModal.pricing?.total}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span>{refundModal.status}</span></div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4">This will initiate a Razorpay refund. Money will reflect in 5–7 business days.</p>
                  <div className="flex gap-2">
                    <Button className="flex-1 sunrise-gradient text-primary-foreground" onClick={handleRefund}>Confirm Refund</Button>
                    <Button variant="outline" onClick={() => setRefundModal(null)}>Cancel</Button>
                  </div>
                </motion.div>
              </div>
            )}
          </div>
        )}

        {/* ── BROADCAST ── */}
        {activeTab === 'broadcast' && (
          <div className="max-w-xl space-y-4">
            <div className="glass-card p-6">
              <h3 className="font-heading text-lg font-semibold mb-1 flex items-center gap-2">
                <Bell className="h-5 w-5 text-primary" /> Broadcast Notification
              </h3>
              <p className="text-xs text-muted-foreground mb-5">Send a notification to all users or a specific role.</p>

              <div className="space-y-4">
                <div>
                  <Label>Target Audience</Label>
                  <select value={broadcastRole} onChange={e => setBroadcastRole(e.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    <option value="">Everyone (all active users)</option>
                    <option value="user">Users only</option>
                    <option value="shopkeeper">Shopkeepers only</option>
                  </select>
                </div>
                <div>
                  <Label>Title</Label>
                  <Input value={broadcastTitle} onChange={e => setBroadcastTitle(e.target.value)} placeholder="e.g. System Maintenance Notice" className="mt-1.5" />
                </div>
                <div>
                  <Label>Message</Label>
                  <textarea
                    value={broadcastMsg}
                    onChange={e => setBroadcastMsg(e.target.value)}
                    placeholder="Write your message here..."
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm min-h-[100px]"
                  />
                </div>

                <div className="rounded-xl bg-orange-50 border border-orange-100 p-3 text-xs text-orange-700">
                  ⚠️ This will send a notification to <strong>{broadcastRole || 'all'}</strong> users immediately. Double-check before sending.
                </div>

                <Button onClick={handleBroadcast} disabled={broadcasting} className="w-full sunrise-gradient text-primary-foreground">
                  {broadcasting ? 'Sending...' : '📢 Send Broadcast'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── SETTINGS ── */}
        {activeTab === 'settings' && (
          <div className="max-w-xl space-y-6">

            {/* ── System Announcement & Software Maintenance Broadcast ── */}
            <div className="glass-card p-6 border-l-4 border-l-orange-500">
              <h3 className="font-heading text-lg font-semibold mb-1 flex items-center gap-2">
                <Wrench className="h-5 w-5 text-orange-500" /> System Announcement & Maintenance Mode
              </h3>
              <p className="text-xs text-muted-foreground mb-5">
                Send a real-time broadcast message to all users and shopkeepers (e.g. "Software is under maintenance from 11 PM to 12 AM").
              </p>

              <div className="space-y-4">
                {/* Maintenance Mode Toggle */}
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-orange-50/50 border border-orange-100">
                  <div>
                    <Label className="font-bold text-gray-800">Global Maintenance Mode</Label>
                    <p className="text-xs text-muted-foreground">
                      Display maintenance notice & banner to all users.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMaintenanceMode(prev => !prev)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${maintenanceMode ? 'bg-red-600' : 'bg-gray-300'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${maintenanceMode ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>

                <div>
                  <Label>Announcement Type</Label>
                  <select
                    value={announcementType}
                    onChange={e => setAnnouncementType(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="maintenance">🛠️ Maintenance Notice (Red Banner)</option>
                    <option value="warning">⚠️ System Warning (Amber Banner)</option>
                    <option value="info">📢 Information / News (Blue Banner)</option>
                  </select>
                </div>

                <div>
                  <Label>Broadcast Message</Label>
                  <textarea
                    rows={3}
                    value={systemAnnouncement}
                    onChange={e => setSystemAnnouncement(e.target.value)}
                    placeholder="e.g. Software is under maintenance from 11:00 PM to 12:00 AM. Orders will be queued."
                    className="mt-1.5 w-full rounded-lg border border-border bg-background p-3 text-sm focus:ring-2 focus:ring-orange-500"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    This message will be broadcast live over Socket.io and displayed at the top of all user & shop screens.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <Button
                    onClick={handleUpdateAnnouncement}
                    disabled={announcementLoading}
                    className="flex-1 bg-gradient-to-r from-red-600 to-orange-600 text-white font-semibold"
                  >
                    {announcementLoading ? 'Broadcasting...' : '📢 Send Broadcast'}
                  </Button>
                  {(maintenanceMode || systemAnnouncement) && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleTurnOffAnnouncement}
                      disabled={announcementLoading}
                      className="border-red-300 text-red-600 hover:bg-red-50 font-semibold"
                    >
                      🔴 Turn OFF Announcement
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* ── Global Commission Rate ── */}
            <div className="glass-card p-6">
              <h3 className="font-heading text-lg font-semibold mb-1 flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-orange-500" /> Global Commission Rate
              </h3>
              <p className="text-xs text-muted-foreground mb-5">
                Default commission % charged on every order. Applied when a shop has no custom margin set.
                The commission is added on top of the shop's base price — customer pays it, platform keeps it.
              </p>

              <div className="space-y-4">
                <div>
                  <Label>Commission Label</Label>
                  <Input
                    value={commissionLabel}
                    onChange={e => setCommissionLabel(e.target.value)}
                    placeholder="e.g. Platform Commission"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label>Default Commission Rate (%)</Label>
                  <div className="flex gap-2 mt-1.5">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={commissionRate}
                      onChange={e => setCommissionRate(e.target.value)}
                      placeholder="e.g. 10"
                      className="flex-1"
                    />
                    <span className="flex items-center text-sm text-muted-foreground px-2">%</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Example: For a ₹100 order at {commissionRate || 10}% commission, the customer pays ₹100 (+₹1 if &gt;5 pages). The platform commission of ₹{(100 * Number(commissionRate || 10) / 100).toFixed(0)} is deducted from the shopkeeper, who receives ₹{(100 - 100 * Number(commissionRate || 10) / 100).toFixed(0)}.
                  </p>
                </div>

                {/* Split preview */}
                {commissionRate && Number(commissionRate) > 0 && (
                  <div className="rounded-xl bg-orange-50 border border-orange-100 p-4 text-xs space-y-1">
                    <p className="font-semibold text-orange-800 mb-2">💡 Split Preview (for ₹100 order, &gt;5 pages)</p>
                    <div className="flex justify-between text-orange-700">
                      <span>Customer pays (₹100 printing + ₹1 page fee)</span>
                      <span className="font-bold">₹101.00</span>
                    </div>
                    <div className="flex justify-between text-orange-700">
                      <span>Platform commission ({commissionRate}% from shopkeeper)</span>
                      <span className="font-bold">₹{(100 * Number(commissionRate) / 100).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-orange-700">
                      <span>Admin total revenue (Commission + ₹1 page fee)</span>
                      <span className="font-bold">₹{(100 * Number(commissionRate) / 100 + 1).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-orange-900 border-t border-orange-200 pt-1 mt-1">
                      <span>Shop receives (₹100 - {commissionRate}% commission)</span>
                      <span className="font-bold">₹{(100 - 100 * Number(commissionRate) / 100).toFixed(2)}</span>
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleUpdateCommission}
                  disabled={commissionLoading}
                  className="w-full sunrise-gradient text-primary-foreground"
                >
                  {commissionLoading ? 'Saving...' : '💾 Save Commission Settings'}
                </Button>
              </div>
            </div>

            {/* ── Apply to All Shops ── */}
            <div className="glass-card p-6">
              <h3 className="font-heading text-base font-semibold mb-1">Apply to All Shops</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Bulk-apply the global commission rate to shops. Useful after changing the global rate.
              </p>
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  disabled={commissionLoading}
                  onClick={() => handleApplyToAll(false)}
                  className="w-full text-sm"
                >
                  Apply to shops with 0% margin only
                </Button>
                <Button
                  variant="outline"
                  disabled={commissionLoading}
                  onClick={() => handleApplyToAll(true)}
                  className="w-full text-sm text-orange-600 border-orange-300"
                >
                  ⚠️ Override ALL shops (including custom margins)
                </Button>
              </div>
            </div>

            {/* ── Per-Shop Margin Override ── */}
            <div className="glass-card p-6">
              <h3 className="font-heading text-base font-semibold mb-1">Per-Shop Margin Override</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Set a custom commission % for a specific shop. Overrides the global rate for that shop only.
                Set to 0 to revert to the global default.
              </p>
              <div className="space-y-4">
                <div>
                  <Label>Select Shop</Label>
                  <select
                    value={selectedShopId}
                    onChange={e => setSelectedShopId(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Choose a shop...</option>
                    {shops.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.name} — current: {s.platformMargin > 0 ? `${s.platformMargin}% (custom)` : `0% (uses global ${commissionRate}%)`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Custom Margin % (0 = use global default)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={margin}
                    onChange={e => setMargin(e.target.value)}
                    placeholder="e.g. 15"
                    className="mt-1.5"
                  />
                </div>
                <Button onClick={handleMargin} className="w-full sunrise-gradient text-primary-foreground">
                  Update Shop Margin
                </Button>
              </div>
            </div>

          </div>
        )}

      </div>
      <Footer />
    </div>
  );
};

export default AdminDashboard;