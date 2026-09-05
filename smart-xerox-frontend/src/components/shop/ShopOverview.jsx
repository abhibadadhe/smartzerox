import React from 'react';
import { ShoppingCart, IndianRupee, Clock, CheckCircle, Printer, Download, ToggleRight } from 'lucide-react';

const StatCard = ({ title, value, icon: Icon, colorClass, bgClass }) => (
  <div className={`${bgClass} p-6 rounded-2xl shadow-sm border border-opacity-20 flex items-center gap-4 hover:shadow-xl hover:scale-105 transition-all duration-300 group cursor-default`}>
    <div className={`p-4 rounded-xl ${colorClass} group-hover:scale-110 transition-transform duration-300`}>
      <Icon className="text-white" size={24} />
    </div>
    <div className="flex-1">
      <p className="text-xs text-opacity-70 font-bold uppercase tracking-wider">{title}</p>
      <h3 className="text-3xl font-bold mt-1">{value}</h3>
    </div>
  </div>
);

const ShopOverview = ({ orders = [], shopData, onToggleStatus, token, user }) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

  const todayOrders = orders.filter(o => new Date(o.createdAt) >= todayStart && o.status !== 'pending_payment').length;
  const pendingOrders = orders.filter(o => ['paid', 'accepted', 'queued', 'printing', 'ready'].includes(o.status)).length;
  
  // Current calendar month orders (resets on 1st of every month)
  const monthOrders = orders.filter(o => new Date(o.createdAt) >= currentMonthStart);
  const monthRevenueOrders = monthOrders.filter(o => ['paid', 'accepted', 'queued', 'printing', 'ready', 'picked_up'].includes(o.status));
  const monthRevenue = monthRevenueOrders.reduce((sum, o) => sum + (o.pricing?.shopReceivable ?? o.pricing?.total ?? 0), 0);
  const totalMonthOrders = monthOrders.filter(o => o.status !== 'pending_payment').length;

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">Welcome back, {shopData?.name || 'Partner'}</p>
        </div>

        {/* Shop Status Toggle */}
        <div className="flex items-center gap-4 bg-white px-5 py-3 rounded-2xl shadow-lg border border-slate-100 hover:shadow-xl transition-shadow duration-300">
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full ${shopData?.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
            <span className="font-semibold text-slate-700 text-sm">{shopData?.isOpen ? 'Shop Open' : 'Shop Closed'}</span>
          </div>
          <button onClick={onToggleStatus}
            className={`relative inline-flex h-7 w-14 items-center rounded-full transition-all duration-300 ${shopData?.isOpen ? 'bg-emerald-500 shadow-lg shadow-emerald-500/30' : 'bg-slate-300'}`}>
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-all duration-300 shadow-md ${shopData?.isOpen ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Today's Orders"
          value={todayOrders}
          icon={ShoppingCart}
          colorClass="bg-gradient-to-br from-blue-500 to-blue-600"
          bgClass="bg-gradient-to-br from-blue-50 to-blue-100 text-blue-900"
        />
        <StatCard
          title="Monthly Revenue"
          value={`₹${monthRevenue.toFixed(0)}`}
          icon={IndianRupee}
          colorClass="bg-gradient-to-br from-emerald-500 to-emerald-600"
          bgClass="bg-gradient-to-br from-emerald-50 to-emerald-100 text-emerald-900"
        />
        <StatCard
          title="Pending Orders"
          value={pendingOrders}
          icon={Clock}
          colorClass="bg-gradient-to-br from-amber-500 to-orange-600"
          bgClass="bg-gradient-to-br from-amber-50 to-orange-100 text-amber-900"
        />
        <StatCard
          title="Monthly Orders"
          value={totalMonthOrders}
          icon={CheckCircle}
          colorClass="bg-gradient-to-br from-violet-500 to-purple-600"
          bgClass="bg-gradient-to-br from-violet-50 to-purple-100 text-violet-900"
        />
      </div>
    </div>
  );
};


export default ShopOverview;
