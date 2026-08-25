import React from 'react';
import { 
  LayoutDashboard, 
  ShoppingBag, 
  Printer, 
  Wallet, 
  User, 
  LogOut,
  BookOpen
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const ShopSidebar = ({ activeTab, setActiveTab, shopData }) => {
  const { logout, user } = useAuth();

  const isAissmsShop = user?.role === 'admin' || /aissms|AISSMS/i.test(shopData?.name || '');

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'orders', label: 'Orders', icon: ShoppingBag },
    ...(isAissmsShop ? [{ id: 'kit-orders', label: 'Kit Orders', icon: BookOpen }] : []),
    { id: 'printers', label: 'Printers', icon: Printer },
    { id: 'settlements', label: 'Settlements', icon: Wallet },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  return (
    <aside className="w-64 bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-slate-300 flex flex-col h-screen border-r border-slate-700/50 backdrop-blur-sm" id="shop-sidebar">
      {/* Logo Section */}
      <div className="p-6 pb-4 border-b border-slate-700/30">
        <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl p-3 w-full flex items-center justify-center shadow-lg">
          <img 
            src="/shop-logo.png" 
            alt="Smart Xerox Partner" 
            className="h-12 object-contain"
          />
        </div>
        <p className="text-[9px] text-slate-500 mt-3 uppercase tracking-[0.15em] text-center font-bold">Partner Hub</p>
        {shopData && (
          <div className="flex items-center justify-center gap-2 mt-3 px-3 py-2 bg-slate-700/30 rounded-lg">
            <span className={`w-2 h-2 rounded-full ${shopData.isOpen ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`}></span>
            <span className="text-xs text-slate-300 truncate font-medium">{shopData.name || 'My Shop'}</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 mt-2 px-3 py-4">
        <ul className="space-y-2">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <li key={item.id}>
                <button
                  onClick={() => setActiveTab(item.id)}
                  id={`shop-nav-${item.id}`}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm rounded-xl transition-all duration-250 group ${
                    isActive 
                      ? 'bg-gradient-to-r from-orange-500/20 to-amber-500/10 text-white shadow-lg shadow-orange-500/10 border border-orange-500/30' 
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'
                  }`}
                >
                  <item.icon size={18} className={`transition-all duration-250 ${isActive ? 'text-orange-400 scale-110' : 'text-slate-500 group-hover:text-orange-400'}`} />
                  <span className={`font-medium transition-all duration-250 ${isActive ? 'font-semibold' : ''}`}>{item.label}</span>
                  {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse"></div>}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Logout */}
      <div className="p-4 border-t border-slate-700/30">
        <button
          onClick={logout}
          id="shop-logout-btn"
          className="w-full flex items-center gap-3 px-4 py-3 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition-all duration-250 font-medium text-sm group"
        >
          <LogOut size={18} className="group-hover:scale-110 transition-transform duration-250" />
          <span>Log Out</span>
        </button>
      </div>
    </aside>
  );
};

export default ShopSidebar;
