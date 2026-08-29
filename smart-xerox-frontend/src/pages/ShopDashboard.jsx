import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { shopAPI, orderAPI } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { toast } from 'sonner';
import { Menu, X } from 'lucide-react';
import ShopSidebar from '@/components/layout/ShopSidebar';
import ShopOverview from '@/components/shop/ShopOverview';
import ShopOrders from '@/components/shop/ShopOrders';
import ShopPrinters from '@/components/shop/ShopPrinters';
import ShopSettlements from '@/components/shop/ShopSettlements';
import ShopProfile from '@/components/shop/ShopProfile';
import KitShopDashboard from '@/pages/kit/KitShopDashboard';

const ShopDashboard = () => {
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('dashboard');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myShop, setMyShop] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchOrders = useCallback(async (silent = false) => {
    try {
      const res = await shopAPI.getShopOrders('limit=100');
      setOrders(res.data.data?.orders || res.data.orders || []);
    } catch {
      if (!silent) toast.error('Could not load orders.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchShop = useCallback(async () => {
    try {
      const res = await shopAPI.getMyShop();
      const shop = res.data.data?.shop || res.data.shop || res.data;
      setMyShop(shop);
      if (shop?._id) getSocket().emit('join:shop', shop._id);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchShop(); fetchOrders(); }, [fetchShop, fetchOrders]);

  // ── Socket listeners ───────────────────────────────────────────────────────
  useEffect(() => {
    const s = getSocket();
    const onStatusUpdate = (data) => {
      if (!data?.orderId) { fetchOrders(true); return; }
      setOrders(prev => {
        const idx = prev.findIndex(o => o._id === data.orderId);
        if (idx === -1) { fetchOrders(true); return prev; }
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          status: data.status,
          ...(data.pickupCode ? { pickup: { ...updated[idx].pickup, pickupCode: data.pickupCode } } : {}),
        };
        return updated;
      });
    };
    s.on('order:status_update', onStatusUpdate);
    return () => s.off('order:status_update', onStatusUpdate);
  }, [fetchOrders]);

  useEffect(() => {
    const s = getSocket();
    const onNew = () => { toast.info('🔔 New order received!'); fetchOrders(true); };
    s.on('order:new', onNew);
    return () => s.off('order:new', onNew);
  }, [fetchOrders]);

  useEffect(() => {
    const s = getSocket();
    const onOutOfPaper = (data) => { toast.error(`🖨️ OUT OF PAPER — Order #${data.orderNumber || data.orderId?.slice(-6)}`, { duration: 10000 }); fetchOrders(true); };
    const onPrintError = (data) => { toast.error(`🖨️ PRINTER ERROR — ${data.error || 'Check printer'}`, { duration: 8000 }); fetchOrders(true); };
    const onPrintComplete = (data) => { toast.success(`✅ Printing complete — Order #${data.orderNumber || data.orderId?.slice(-6)}`); fetchOrders(true); };
    const onPrintStarted = (data) => { toast.info(`🖨️ Printing started — Order #${data.orderNumber || data.orderId?.slice(-6)}`); fetchOrders(true); };
    s.on('print:out_of_paper', onOutOfPaper);
    s.on('print:error', onPrintError);
    s.on('print:completed', onPrintComplete);
    s.on('print:started', onPrintStarted);
    return () => {
      s.off('print:out_of_paper', onOutOfPaper);
      s.off('print:error', onPrintError);
      s.off('print:completed', onPrintComplete);
      s.off('print:started', onPrintStarted);
    };
  }, [fetchOrders]);

  // ── Order action handlers ──────────────────────────────────────────────────
  // NOTE: Accept is removed — orders auto-dispatch after payment

  const handleReject = async (orderId, reason = '') => {
    if (!reason.trim()) { toast.error('Please enter a reason'); return; }
    setOrders(prev => prev.map(o => o._id === orderId ? { ...o, status: 'rejected' } : o));
    try {
      await orderAPI.reject(orderId, reason);
      toast.success('Order rejected');
    } catch (err) {
      fetchOrders(true);
      toast.error(err.response?.data?.message || 'Failed to reject');
    }
  };

  const triggerPrint = async (orderId) => {
    window.location.href = ``;
    toast.success('Opening Desktop Print Agent...');
  };

  const handleVerifyPickup = async (orderId, otp) => {
    setOrders(prev => prev.map(o => o._id === orderId ? { ...o, status: 'picked_up' } : o));
    try {
      await orderAPI.verifyPickup({ orderId, pickupCode: otp });
      toast.success('OTP verified! Order collected ✅');
    } catch (err) {
      fetchOrders(true);
      toast.error(err.response?.data?.message || 'Invalid OTP');
    }
  };

  const handleUpdateStatus = async (orderId, status) => {
    setOrders(prev => prev.map(o => o._id === orderId ? { ...o, status } : o));
    try {
      await orderAPI.updateStatus(orderId, status);
      toast.success(`Order marked as ${status}`);
    } catch (err) {
      fetchOrders(true);
      toast.error(err.response?.data?.message || 'Failed to update');
    }
  };

  const handleToggleShop = async () => {
    try {
      await shopAPI.toggleStatus();
      const newStatus = !myShop?.isOpen;
      setMyShop(prev => ({ ...prev, isOpen: newStatus }));
      toast.success(`Shop is now ${newStatus ? 'Open 🟢' : 'Closed 🔴'}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to toggle');
    }
  };

  const handleDownload = async (orderId, docId) => {
    try {
      const res = await orderAPI.getDocumentUrl(orderId, docId);
      const url = res.data.data?.downloadUrl;
      if (url) { window.open(url, '_blank'); toast.success('PDF opened'); }
      else toast.error('Could not get download link');
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  const handleResumePrint = async (orderId) => {
    try {
      await orderAPI.resumePrint(orderId);
      toast.success('▶️ Print job resumed!');
      fetchOrders(true);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to resume');
    }
  };

  // ── Tab switch handler (also closes mobile sidebar) ─────────────────────────
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSidebarOpen(false);
  };

  // ── Render active tab content ──────────────────────────────────────────────
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <ShopOverview
            orders={orders}
            shopData={myShop}
            onToggleStatus={handleToggleShop}
            token={token}
            user={user}
          />
        );
      case 'orders':
        return (
          <ShopOrders
            handleReject={handleReject}
            triggerPrint={triggerPrint}
            handleVerifyPickup={handleVerifyPickup}
            handleUpdateStatus={handleUpdateStatus}
            navigate={navigate}
          />
        );
      case 'kit-orders':
        return <KitShopDashboard />;
      case 'printers':
        return <ShopPrinters />;
      case 'settlements':
        return <ShopSettlements orders={orders} shopData={myShop} />;
      case 'profile':
        return <ShopProfile shopData={myShop} setShopData={setMyShop} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 overflow-hidden">
      {/* Mobile hamburger */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="md:hidden fixed top-4 left-4 z-50 p-2.5 bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110"
        id="shop-mobile-menu-toggle"
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-30 transition-opacity duration-300"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`fixed md:static z-40 transition-all duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <ShopSidebar activeTab={activeTab} setActiveTab={handleTabChange} shopData={myShop} />
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 md:p-8 max-w-7xl mx-auto">
          {renderContent()}
        </div>
      </main>
    </div>
  );
};

export default ShopDashboard;