import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { notificationAPI } from '@/lib/api';
import { onNotification } from '@/lib/socket';
import { Button } from '@/components/ui/button';
import { Menu, X, User, LogOut, LayoutDashboard, Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import SystemAnnouncementBanner from '@/components/ui/SystemAnnouncementBanner';

const Navbar = () => {
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen]         = useState(false);
  const [notifOpen, setNotifOpen]           = useState(false);
  const [notifications, setNotifications]   = useState([]);
  const [unreadCount, setUnreadCount]       = useState(0);
  const notifRef = useRef(null);

  const getDashboardPath = () => {
    if (user?.role === 'admin')      return '/admin';
    if (user?.role === 'shopkeeper') return '/shop';   // FIX: was 'shop' not 'shopkeeper'
    return '/dashboard';
  };

  const getShopName = (u) => {
    if (!u) return '';
    if (typeof u.shop === 'object' && u.shop?.name) return u.shop.name;
    if (typeof u.shopName === 'string') return u.shopName;
    return '';
  };

  const currentShopName = getShopName(user);
  const isAissmsUser = /aissms|AISSMS/i.test(currentShopName);
  const showKitLink = user?.role !== 'shopkeeper' && (user?.role === 'admin' || isAissmsUser);

  // Fetch notifications when logged in
  useEffect(() => {
    if (!isAuthenticated) return;
    notificationAPI.getAll()
      .then(res => {
        const notifs = res.data?.data?.notifications || res.data?.notifications || [];
        setNotifications(notifs);
        setUnreadCount(notifs.filter(n => !n.isRead).length);
      })
      .catch(() => {});
  }, [isAuthenticated]);

  // Real-time new notifications
  useEffect(() => {
    if (!isAuthenticated) return;
    const cleanup = onNotification((notif) => {
      setNotifications(prev => [notif, ...prev]);
      setUnreadCount(prev => prev + 1);
    });
    return cleanup;
  }, [isAuthenticated]);

  // Close notif dropdown when clicking outside — but NOT when clicking buttons inside it
  useEffect(() => {
    const handler = (e) => {
      if (!notifRef.current) return;
      if (notifRef.current.contains(e.target)) return; // click inside — keep open
      setNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await notificationAPI.markAllRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch { /* silent */ }
  };

  const handleDeleteNotif = async (id, e) => {
    e.stopPropagation();
    e.preventDefault();
    const notif = notifications.find(n => n._id === id);
    setNotifications(prev => prev.filter(n => n._id !== id));
    if (notif && !notif.isRead) setUnreadCount(prev => Math.max(0, prev - 1));
    try {
      await notificationAPI.delete(id);
    } catch {
      if (notif) setNotifications(prev => [notif, ...prev].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
      if (notif && !notif.isRead) setUnreadCount(prev => prev + 1);
    }
  };

  const handleClearAll = async () => {
    const snapshot = [...notifications];
    setNotifications([]);
    setUnreadCount(0);
    try {
      await notificationAPI.deleteAll();
    } catch {
      // Rollback on failure
      setNotifications(snapshot);
      setUnreadCount(snapshot.filter(n => !n.isRead).length);
    }
  };

  const handleLogout = () => { logout(); navigate('/'); };

  return (
    <>
      <SystemAnnouncementBanner />
      <nav className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo.png" alt="Pratibimb" className="h-10 w-auto object-contain" />
        </Link>

        {/* Desktop */}
        <div className="hidden items-center gap-6 md:flex">
          <Link to="/" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">Home</Link>
          <Link to="/services" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">Services</Link>
          {showKitLink && (
            <Link to="/kit" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">📚 Kit</Link>
          )}
          {isAuthenticated ? (
            <>
              <Link to={getDashboardPath()} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">Dashboard</Link>


              {/* Notifications Bell */}
              <div className="relative" ref={notifRef}>
                <button onClick={() => { setNotifOpen(!notifOpen); if (!notifOpen && unreadCount > 0) handleMarkAllRead(); }}
                  className="relative flex h-9 w-9 items-center justify-center rounded-xl hover:bg-secondary transition-colors">
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {/* Notifications dropdown */}
                <AnimatePresence>
                  {notifOpen && (
                    <motion.div initial={{ opacity: 0, y: 8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.95 }}
                      className="absolute right-0 top-11 w-80 rounded-xl border border-border bg-background shadow-xl z-50 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                        <p className="font-semibold text-sm">Notifications</p>
                        <div className="flex items-center gap-3">
                          {notifications.length > 0 && (
                            <button
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={handleClearAll}
                              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                            >
                              Clear all
                            </button>
                          )}
                          {unreadCount > 0 && (
                            <button
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={handleMarkAllRead}
                              className="text-xs text-primary hover:underline"
                            >
                              Mark all read
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {notifications.length === 0 ? (
                          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No notifications yet</div>
                        ) : notifications.slice(0, 20).map((n) => (
                          <div key={n._id} className={`flex items-start gap-3 px-4 py-3 border-b border-border/50 hover:bg-secondary/30 transition-colors ${!n.isRead ? 'bg-primary/5' : ''}`}>
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-medium leading-snug ${!n.isRead ? 'text-foreground' : 'text-muted-foreground'}`}>{n.title}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{n.message}</p>
                              <p className="text-[10px] text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString('en-IN')}</p>
                            </div>
                            <button
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => handleDeleteNotif(n._id, e)}
                              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors mt-0.5 shrink-0"
                              title="Remove"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5">
                  <User className="h-4 w-4 text-secondary-foreground" />
                  <span className="text-sm font-medium text-secondary-foreground">{user?.name}</span>
                </div>
                <Button variant="ghost" size="icon" onClick={handleLogout}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={() => navigate('/login')}>Sign In</Button>
              <Button className="sunrise-gradient text-primary-foreground sunrise-shadow-sm" onClick={() => navigate('/register')}>Get Started</Button>
            </div>
          )}
        </div>

        {/* Mobile Navbar Actions */}
        <div className="flex items-center gap-2 md:hidden">
          {isAuthenticated && (
            <div className="relative" ref={notifRef}>
              <button 
                onClick={() => { setNotifOpen(!notifOpen); if (!notifOpen && unreadCount > 0) handleMarkAllRead(); }}
                className="relative flex h-9 w-9 items-center justify-center rounded-xl hover:bg-secondary transition-colors"
              >
                <Bell className="h-5 w-5 text-muted-foreground" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Mobile Notifications dropdown (simplified positioning) */}
              <AnimatePresence>
                {notifOpen && (
                  <motion.div 
                    initial={{ opacity: 0, y: 8, scale: 0.95 }} 
                    animate={{ opacity: 1, y: 0, scale: 1 }} 
                    exit={{ opacity: 0, y: 8, scale: 0.95 }}
                    className="fixed right-4 top-16 left-4 sm:absolute sm:left-auto sm:right-0 sm:top-11 sm:w-80 rounded-xl border border-border bg-background shadow-2xl z-[60] overflow-hidden"
                  >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <p className="font-semibold text-sm">Notifications</p>
                      <div className="flex items-center gap-3">
                        {notifications.length > 0 && (
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={handleClearAll}
                            className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                          >
                            Clear all
                          </button>
                        )}
                        {unreadCount > 0 && (
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={handleMarkAllRead}
                            className="text-xs text-primary hover:underline"
                          >
                            Mark all read
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="max-h-[60vh] sm:max-h-80 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-muted-foreground">No notifications yet</div>
                      ) : notifications.slice(0, 20).map((n) => (
                        <div key={n._id} className={`flex items-start gap-3 px-4 py-3 border-b border-border/50 hover:bg-secondary/30 transition-colors ${!n.isRead ? 'bg-primary/5' : ''}`}>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-medium leading-snug ${!n.isRead ? 'text-foreground' : 'text-muted-foreground'}`}>{n.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{n.message}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString('en-IN')}</p>
                          </div>
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => handleDeleteNotif(n._id, e)}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors mt-0.5 shrink-0"
                            title="Remove"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Mobile toggle */}
          <button className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-secondary transition-colors" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-border/50 bg-background md:hidden">
            <div className="flex flex-col gap-2 p-4">
              <Link to="/" onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-secondary">Home</Link>
              <Link to="/services" onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-secondary">Services</Link>
              {showKitLink && (
                <Link to="/kit" onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-secondary">📚 Kit</Link>
              )}
              {isAuthenticated ? (
                <>
                  <Link to={getDashboardPath()} onClick={() => setMobileOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-secondary">
                    <LayoutDashboard className="h-4 w-4" /> Dashboard
                  </Link>
                  {user?.role === 'user' && (
                    <Link to="/orders" onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-secondary">Orders</Link>
                  )}
                  <button onClick={() => { handleLogout(); setMobileOpen(false); }} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10">
                    <LogOut className="h-4 w-4" /> Logout
                  </button>
                </>
              ) : (
                <>
                  <Link to="/login" onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-secondary">Sign In</Link>
                  <Link to="/register" onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2 text-sm font-medium sunrise-gradient text-primary-foreground text-center">Get Started</Link>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
    </>
  );
};

export default Navbar;