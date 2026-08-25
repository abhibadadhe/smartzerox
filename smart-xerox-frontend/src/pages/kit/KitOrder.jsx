import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ShoppingCart, X, Upload, CheckCircle2, Loader2, ArrowLeft, Search, Clock, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import { kitAPI } from '@/lib/kitApi';
import { useAuth } from '@/contexts/AuthContext';

const DUMMY_QR = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=upi://pay?pa=pratibimb@upi%26pn=Pratibimb%26am=';
const DEPARTMENTS = ['Computer', 'IT', 'Electrical', 'E&TC', 'AIOS', 'Instrumentation'];

const STATUS_CONFIG = {
  'Pending Verification': { color: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: '⏳', label: 'Pending Verification', desc: 'Your order is received. We are verifying your payment.' },
  'Payment Verified':     { color: 'bg-blue-100 text-blue-800 border-blue-200',       icon: '✅', label: 'Payment Verified',     desc: 'Payment confirmed! Your order is being prepared.' },
  'Accepted':             { color: 'bg-indigo-100 text-indigo-800 border-indigo-200', icon: '📦', label: 'Accepted',             desc: 'Order accepted. Will be ready for pickup soon.' },
  'Completed':            { color: 'bg-green-100 text-green-800 border-green-200',    icon: '🎉', label: 'Completed',            desc: 'Your order is ready for pickup!' },
  'Rejected':             { color: 'bg-red-100 text-red-800 border-red-200',          icon: '❌', label: 'Rejected',             desc: 'Order was rejected. Please contact us.' },
  'Suspicious':           { color: 'bg-amber-100 text-amber-800 border-amber-200',    icon: '🔍', label: 'Under Review',         desc: 'Your payment is being verified by our team. This usually takes 24–48 hours.' },
};

const STATUS_STEPS = ['Pending Verification', 'Payment Verified', 'Accepted', 'Completed'];

// ─── Order Status Tracker ─────────────────────────────────────────────────────
function OrderTracker({ order }) {
  const cfg = STATUS_CONFIG[order.orderStatus] || STATUS_CONFIG['Pending Verification'];
  const isRejected = order.orderStatus === 'Rejected';
  const isSuspicious = order.orderStatus === 'Suspicious';
  const currentIdx = isRejected ? -1 : isSuspicious ? 0 : STATUS_STEPS.indexOf(order.orderStatus);

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-xs text-muted-foreground">Order ID</p>
          <p className="font-mono font-bold">{String(order._id).slice(-8).toUpperCase()}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold border ${cfg.color}`}>
          {cfg.icon} {cfg.label}
        </span>
      </div>

      <p className="text-sm text-muted-foreground">{cfg.desc}</p>

      {/* Progress stepper */}
      {!isRejected && !isSuspicious && (
        <div className="flex items-center gap-0">
          {STATUS_STEPS.map((s, i) => {
            const done    = i <= currentIdx;
            const isLast  = i === STATUS_STEPS.length - 1;
            const isFirst = i === 0;
            return (
              <div key={s} className="flex items-center flex-1">
                <div className={`h-0.5 flex-1 ${isFirst ? 'bg-transparent' : done ? 'bg-primary' : 'bg-muted'}`} />
                <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {done ? '✓' : i + 1}
                </div>
                <div className={`h-0.5 flex-1 ${isLast ? 'bg-transparent' : i < currentIdx ? 'bg-primary' : 'bg-muted'}`} />
              </div>
            );
          })}
        </div>
      )}

      {/* Under Review notice for suspicious orders */}
      {isSuspicious && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm">
          <p className="font-semibold text-amber-900 flex items-center gap-2">
            <span>🔍</span> Payment Under Review
          </p>
          <p className="text-amber-800 text-xs mt-1">
            Our team is reviewing your payment for verification. You'll be notified via email once the review is complete. This usually takes 24–48 hours.
          </p>
        </div>
      )}

      <div className="text-xs text-muted-foreground space-y-0.5">
        <p>{order.year} Year {order.department ? `· ${order.department}` : '· Common Kit'} · ₹{order.totalAmount}</p>
        <p>{new Date(order.createdAt).toLocaleString('en-IN')}</p>
      </div>

      {/* Status history */}
      {order.statusHistory?.length > 0 && (
        <div className="border-t border-border pt-3 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">History</p>
          {[...order.statusHistory].reverse().map((h, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <span className="shrink-0">{new Date(h.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="font-medium text-foreground">{h.status}</span>
              {h.note && <span className="italic">— {h.note}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Track Orders Tab ─────────────────────────────────────────────────────────
function TrackOrders({ user }) {
  const [orders, setOrders]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [email, setEmail]     = useState('');
  const [phone, setPhone]     = useState('');
  const [searched, setSearched] = useState(false);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await kitAPI.getMyOrders(
        user ? undefined : email,
        user ? undefined : phone
      );
      setOrders(res.data.data.orders);
      setSearched(true);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not fetch orders');
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch for logged-in users
  useEffect(() => {
    if (user) fetchOrders();
  }, [user]);

  return (
    <div className="space-y-4">
      {!user && (
        <div className="glass-card p-5 space-y-3">
          <h3 className="font-semibold">Track Your Order</h3>
          <p className="text-sm text-muted-foreground">Enter the email and phone you used while placing the order.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Email</Label>
              <Input className="mt-1" type="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input className="mt-1" placeholder="9876543210" value={phone} onChange={e => setPhone(e.target.value)} maxLength={10} />
            </div>
          </div>
          <Button onClick={fetchOrders} disabled={loading || !email || !phone}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
            Track Orders
          </Button>
        </div>
      )}

      {loading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}

      {searched && !loading && orders.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">
          <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p>No orders found</p>
        </div>
      )}

      {orders.map(o => <OrderTracker key={o._id} order={o} />)}
    </div>
  );
}

export default function KitOrder() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab]   = useState('order'); // 'order' | 'track'
  const [step, setStep] = useState(0);

  const shopName = typeof user?.shop === 'object' ? user?.shop?.name : (user?.shopName || '');
  const isAissmsUser = /aissms|AISSMS/i.test(shopName);
  if (user && user.role !== 'admin' && !isAissmsUser) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <main className="container mx-auto px-4 py-16 flex-1 flex items-center justify-center">
          <div className="glass-card max-w-md p-8 text-center space-y-4 shadow-xl border border-orange-100">
            <div className="text-4xl">📚</div>
            <h2 className="text-xl font-bold text-gray-800">Practical Kit Orders</h2>
            <p className="text-sm text-muted-foreground">
              Practical Kit Orders are currently exclusive to <strong>AISSMS College</strong> students and print shop.
            </p>
            <Button onClick={() => navigate('/dashboard')} className="w-full sunrise-gradient text-white font-semibold">
              Back to Dashboard
            </Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const [college, setCollege]       = useState('');
  const [year, setYear]             = useState('');
  const [department, setDepartment] = useState('');
  const [subject, setSubject]       = useState('');
  const [subjects, setSubjects]     = useState([]);
  const [notes, setNotes]           = useState([]);
  const [cart, setCart]             = useState([]);
  const [loading, setLoading]       = useState(false);

  const [name, setName]               = useState(user?.name || '');
  const [phone, setPhone]             = useState('');
  const [email, setEmail]             = useState(user?.email || '');
  const [txnId, setTxnId]             = useState('');
  const [instructions, setInstructions] = useState('');
  const [screenshot, setScreenshot]   = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState('');
  const [screenshotError, setScreenshotError] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [placedOrderId, setPlacedOrderId] = useState('');

  useEffect(() => {
    if (user) { setName(user.name || ''); setEmail(user.email || ''); }
  }, [user]);

  useEffect(() => {
    if (step === 3 && year && year !== '1st' && department) {
      setLoading(true);
      kitAPI.getSubjects(year, department)
        .then(r => setSubjects(r.data.data.subjects))
        .catch(() => toast.error('Failed to load subjects'))
        .finally(() => setLoading(false));
    }
  }, [step, year, department]);

  useEffect(() => {
    if (step === 4 && subject) {
      setLoading(true);
      kitAPI.getNotes(subject)
        .then(r => setNotes(r.data.data.notes))
        .catch(() => toast.error('Failed to load notes'))
        .finally(() => setLoading(false));
    }
  }, [step, subject]);

  const total = cart.reduce((s, i) => s + i.price, 0);

  const addToCart = (note) => {
    if (cart.find(c => c.id === note.id)) { toast.info('Already in cart'); return; }
    setCart(p => [...p, note]);
    toast.success('Added to cart');
  };

  const removeFromCart = (id) => setCart(p => p.filter(c => c.id !== id));

  const handleSelectYear = (y) => {
    setYear(y); setCart([]);
    if (y === '1st') {
      setLoading(true);
      kitAPI.getSubjects('1st', '')
        .then(r => { setCart(r.data.data.firstYearKit.notes.map(n => ({ ...n }))); })
        .catch(() => toast.error('Failed to load kit'))
        .finally(() => setLoading(false));
      setStep(5); // 1st year → skip dept/subject/notes → go straight to Cart
    } else {
      setStep(2); // 2nd-4th year → go to Department selection
    }
  };

  const handleScreenshot = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScreenshot(file);
    setScreenshotPreview(URL.createObjectURL(file));
    setScreenshotError(false);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !phone.trim() || !email.trim()) { toast.error('Name, phone and email are required'); return; }
    if (!/^[6-9]\d{9}$/.test(phone)) { toast.error('Enter a valid 10-digit phone number'); return; }
    const trimmedTxn = txnId.trim();
    if (!trimmedTxn || trimmedTxn.length < 12) {
      toast.error('Please enter a valid 12-digit UPI UTR / Transaction ID (e.g. 423891047291).');
      return;
    }
    const dummyPatterns = /^(UPI\d+|0{6,}|1{6,}|2{6,}|3{6,}|4{6,}|5{6,}|6{6,}|7{6,}|8{6,}|9{6,}|123456|12345678|123456789|1234567890|123456789012|987654321|098765456|0987654321|test|demo|asdf|qwerty|null|undefined)/i;
    if (dummyPatterns.test(trimmedTxn)) {
      toast.error('Invalid UPI Transaction ID. Please enter a valid 12-digit numeric UTR number from your GPay, PhonePe, or Paytm payment receipt.');
      return;
    }
    if (!screenshot) { setScreenshotError(true); toast.error('Please upload a valid payment receipt screenshot (showing ₹ amount & UTR)'); return; }
    if (cart.length === 0) { toast.error('Cart is empty'); return; }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('phone', phone.trim());
      fd.append('email', email.trim());
      fd.append('year', year);
      fd.append('department', department || '');
      fd.append('orderType', year === '1st' ? 'FIRST_YEAR_KIT' : 'CUSTOM_NOTES');
      fd.append('totalAmount', total);
      fd.append('selectedNotes', JSON.stringify(cart));
      fd.append('transactionId', txnId.trim());
      fd.append('specialInstructions', instructions.trim());
      fd.append('paymentScreenshot', screenshot);

      const res = await kitAPI.createOrder(fd);
      setPlacedOrderId(res.data.data.orderId);
      setStep(7);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to place order');
    } finally {
      setSubmitting(false);
    }
  };

  const resetOrder = () => {
    setStep(0); setCart([]); setCollege(''); setYear(''); setDepartment(''); setSubject('');
    setScreenshot(null); setScreenshotPreview(''); setScreenshotError(false); setTxnId(''); setInstructions('');
  };

  const back = () => {
    if (step === 1) setStep(0);                                         // Year → College
    else if (step === 2) setStep(1);                                    // Dept → Year
    else if (step === 3) { setSubjects([]); setStep(2); }              // Subject → Dept
    else if (step === 4) { setNotes([]); setSubject(''); setStep(3); } // Notes → Subject list
    else if (step === 5) setStep(year === '1st' ? 1 : 3);             // Cart → Subject list (so user can add more)
    else if (step === 6) setStep(5);                                    // Payment → Cart
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 py-8 max-w-2xl">

        <div className="mb-6">
          <h1 className="font-heading text-3xl font-bold">📚 Kit Section</h1>
          <p className="text-muted-foreground mt-1">Order academic notes for your year & department</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[['order', '🛒 Place Order'], ['track', '📦 Track Orders']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`rounded-xl px-5 py-2.5 text-sm font-medium transition-all ${tab === key ? 'sunrise-gradient text-primary-foreground sunrise-shadow-sm' : 'bg-secondary text-secondary-foreground'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'track' && <TrackOrders user={user} />}

        {tab === 'order' && (
          <>
            {/* Step indicator */}
            {step < 7 && (
              <div className="flex items-center gap-1 mb-5 flex-wrap">
                {['College','Year','Dept','Subject','Notes','Cart','Payment'].map((s, i) => (
                  <div key={s} className="flex items-center gap-1">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${i === step ? 'bg-primary text-primary-foreground' : i < step ? 'bg-green-100 text-green-700' : 'bg-secondary text-muted-foreground'}`}>{s}</span>
                    {i < 6 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                  </div>
                ))}
              </div>
            )}

            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.18 }}>

                {/* STEP 0 — College */}
                {step === 0 && (
                  <div className="glass-card p-6">
                    <h2 className="font-semibold text-lg mb-4">Select Your College</h2>
                    <div className="grid grid-cols-2 gap-3">
                      {['COE', 'IOIT'].map(c => (
                        <button key={c} onClick={() => { setCollege(c); setStep(1); }}
                          className="rounded-xl border-2 border-border hover:border-primary p-6 text-center font-bold text-xl transition-all hover:bg-primary/5">
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* STEP 1 — Year */}
                {step === 1 && (
                  <div className="glass-card p-6">
                    <button onClick={back} className="flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>
                    <h2 className="font-semibold text-lg mb-4">Select Your Year <span className="text-muted-foreground text-sm">({college})</span></h2>
                    <div className="grid grid-cols-2 gap-3">
                      {['1st','2nd','3rd','4th'].map(y => (
                        <button key={y} onClick={() => handleSelectYear(y)}
                          className="rounded-xl border-2 border-border hover:border-primary p-6 text-center font-bold text-xl transition-all hover:bg-primary/5">
                          {y} Year
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* STEP 2 — Department */}
                {step === 2 && (
                  <div className="glass-card p-6">
                    <button onClick={back} className="flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>
                    <h2 className="font-semibold text-lg mb-4">Select Department <span className="text-muted-foreground text-sm">({year} Year)</span></h2>
                    <div className="grid grid-cols-2 gap-3">
                      {DEPARTMENTS.map(d => (
                        <button key={d} onClick={() => { setDepartment(d); setStep(3); }}
                          className="rounded-xl border-2 border-border hover:border-primary p-4 text-center font-medium transition-all hover:bg-primary/5">
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* STEP 3 — Subject */}
                {step === 3 && (
                  <div className="glass-card p-6">
                    <div className="flex items-center justify-between mb-4">
                      <button onClick={back} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>
                      {cart.length > 0 && (
                        <button onClick={() => setStep(5)} className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 rounded-full px-3 py-1 hover:bg-primary/20 transition-colors">
                          <ShoppingCart className="h-3 w-3" /> {cart.length} in cart · ₹{total}
                        </button>
                      )}
                    </div>
                    <h2 className="font-semibold text-lg mb-4">Select Subject <span className="text-muted-foreground text-sm">({year} · {department})</span></h2>
                    {loading ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
                      <div className="flex flex-col gap-2">
                        {subjects.map(s => (
                          <button key={s} onClick={() => { setSubject(s); setStep(4); }}
                            className="rounded-xl border border-border hover:border-primary px-4 py-3 text-left font-medium transition-all hover:bg-primary/5 flex items-center justify-between">
                            {s} <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                    )}
                    {cart.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-border">
                        <Button className="w-full sunrise-gradient text-primary-foreground" onClick={() => setStep(5)}>
                          <ShoppingCart className="h-4 w-4 mr-2" /> View Cart ({cart.length} items · ₹{total})
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* STEP 4 — Notes */}
                {step === 4 && (
                  <div className="glass-card p-6">
                    <button onClick={back} className="flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>
                    <h2 className="font-semibold text-lg mb-1">Notes — <span className="text-primary">{subject}</span></h2>
                    <p className="text-xs text-muted-foreground mb-4">Add notes to your cart</p>

                    {/* Cart summary — always visible so user sees items from other subjects */}
                    {cart.length > 0 && (
                      <div className="mb-4 rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm">
                          <ShoppingCart className="h-4 w-4 text-primary shrink-0" />
                          <span className="font-medium text-primary">{cart.length} item{cart.length > 1 ? 's' : ''} in cart</span>
                          <span className="text-muted-foreground">· ₹{total}</span>
                        </div>
                        <Button size="sm" onClick={() => setStep(5)} className="sunrise-gradient text-primary-foreground shrink-0">
                          View Cart
                        </Button>
                      </div>
                    )}

                    {loading ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
                      <div className="flex flex-col gap-3">
                        {notes.map(n => {
                          const inCart = !!cart.find(c => c.id === n.id);
                          return (
                            <div key={n.id} className="rounded-xl border border-border p-4 flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <p className="font-medium text-sm">{n.title}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{n.description}</p>
                                <p className="text-sm font-bold text-primary mt-1">₹{n.price}</p>
                              </div>
                              <Button size="sm" variant={inCart ? 'secondary' : 'default'}
                                onClick={() => inCart ? removeFromCart(n.id) : addToCart(n)}>
                                {inCart ? 'Remove' : '+ Add'}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* STEP 5 — Cart */}
                {step === 5 && (
                  <div className="glass-card p-6">
                    <button onClick={back} className="flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>
                    <h2 className="font-semibold text-lg mb-4">Your Cart</h2>
                    {cart.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <ShoppingCart className="h-10 w-10 mx-auto mb-2 opacity-30" />
                        <p>Cart is empty</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-col gap-2 mb-4">
                          {cart.map(item => (
                            <div key={item.id} className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
                              <span className="text-sm font-medium flex-1">{item.title}</span>
                              <span className="text-sm font-bold text-primary mr-3">₹{item.price}</span>
                              {year !== '1st' && (
                                <button onClick={() => removeFromCart(item.id)} className="text-muted-foreground hover:text-destructive">
                                  <X className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-between border-t border-border pt-3 mb-4">
                          <span className="font-semibold">Total</span>
                          <span className="text-xl font-bold text-primary">₹{total}</span>
                        </div>
                        <Button className="w-full sunrise-gradient text-primary-foreground" onClick={() => setStep(6)}>
                          Proceed to Payment →
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {/* STEP 6 — Payment + Details */}
                {step === 6 && (
                  <div className="space-y-4">
                    <button onClick={back} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>

                    {/* QR */}
                    <div className="glass-card p-6 text-center">
                      <h2 className="font-semibold text-lg mb-1">Scan & Pay</h2>
                      <p className="text-muted-foreground text-sm mb-4">Pay <strong className="text-primary text-lg">₹{total}</strong> using UPI</p>
                      <div className="flex justify-center mb-3">
                        <img src={`${DUMMY_QR}${total}`} alt="Payment QR" className="rounded-xl border border-border w-48 h-48 object-contain" />
                      </div>
                      <p className="text-xs text-muted-foreground">UPI ID: <strong>pratibimb@upi</strong></p>
                      <p className="text-xs text-muted-foreground mt-1">After payment, upload the screenshot below</p>
                    </div>

                    {/* Fraud Prevention Warning */}
                    <div className="glass-card p-4 border border-yellow-200 bg-yellow-50/50">
                      <div className="flex gap-3">
                        <div className="text-xl shrink-0">⚠️</div>
                        <div className="text-sm space-y-1">
                          <p className="font-semibold text-yellow-900">Important: Fraud Prevention</p>
                          <ul className="text-xs text-yellow-800 space-y-0.5 list-disc list-inside">
                            <li>Each payment screenshot is valid for <strong>ONE order only</strong></li>
                            <li>Do not reuse screenshots from previous orders</li>
                            <li>Reused screenshots will be flagged as suspicious</li>
                            <li>Your UPI Transaction ID is required for verification</li>
                          </ul>
                        </div>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="glass-card p-6 space-y-4">
                      <h2 className="font-semibold text-lg">Your Details</h2>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label className="font-semibold">Full Name <span className="text-destructive">*</span></Label>
                          <Input className="mt-1" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
                        </div>
                        <div>
                          <Label className="font-semibold">Phone <span className="text-destructive">*</span></Label>
                          <Input className="mt-1" placeholder="9876543210" value={phone} onChange={e => setPhone(e.target.value)} maxLength={10} />
                        </div>
                        <div className="sm:col-span-2">
                          <Label className="font-semibold">Email <span className="text-destructive">*</span></Label>
                          <Input className="mt-1" type="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} />
                        </div>
                        <div>
                          <Label className="font-semibold">UPI Transaction ID / UTR <span className="text-destructive">*</span></Label>
                          <Input className="mt-1" placeholder="e.g. 423891047291 (12 digits)" value={txnId} onChange={e => setTxnId(e.target.value)} maxLength={30} />
                          <p className="text-xs text-muted-foreground mt-1">Enter authentic 12-digit UTR from GPay, PhonePe, or Paytm</p>
                        </div>
                        <div>
                          <Label className="text-muted-foreground">Special Instructions <span className="text-xs text-green-600 font-semibold">(Optional)</span></Label>
                          <Input className="mt-1" placeholder="Any special requests..." value={instructions} onChange={e => setInstructions(e.target.value)} />
                        </div>
                      </div>

                      {/* Screenshot */}
                      <div>
                        <Label className="font-semibold">Payment Screenshot <span className="text-destructive">*</span></Label>
                        <div className={`mt-1 border-2 border-dashed rounded-xl p-4 text-center transition-colors ${screenshotError ? 'border-destructive bg-destructive/5' : screenshot ? 'border-green-400 bg-green-50/30' : 'border-border hover:border-primary/50'}`}>
                          <input type="file" accept="image/*" id="kit-ss" className="hidden" onChange={handleScreenshot} />
                          <label htmlFor="kit-ss" className="cursor-pointer flex flex-col items-center gap-2">
                            {screenshotPreview ? (
                              <img src={screenshotPreview} alt="preview" className="max-h-40 rounded-lg object-contain" />
                            ) : (
                              <>
                                <Upload className={`h-8 w-8 ${screenshotError ? 'text-destructive' : 'text-muted-foreground'}`} />
                                <p className={`text-sm font-medium ${screenshotError ? 'text-destructive' : 'text-muted-foreground'}`}>
                                  {screenshotError ? '⚠️ Screenshot is required — click to upload' : 'Click to upload payment screenshot'}
                                </p>
                                <p className="text-xs text-muted-foreground">JPEG / PNG · Max 5MB</p>
                              </>
                            )}
                          </label>
                        </div>
                        {screenshotError && (
                          <p className="mt-1.5 text-xs text-destructive font-medium">Please upload your payment screenshot before placing the order.</p>
                        )}
                      </div>

                      <Button className="w-full sunrise-gradient text-primary-foreground" onClick={handleSubmit} disabled={submitting}>
                        {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Placing Order...</> : 'Place Order'}
                      </Button>
                    </div>
                  </div>
                )}

                {/* STEP 7 — Done */}
                {step === 7 && (
                  <div className="glass-card p-8 text-center space-y-4">
                    <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
                    <h2 className="font-heading text-2xl font-bold">Order Placed! 🎉</h2>
                    <p className="text-muted-foreground">Your payment screenshot has been submitted. We'll verify and update you via email.</p>
                    <div className="rounded-xl bg-secondary/50 p-4 text-sm space-y-1">
                      <p>Order ID: <strong className="font-mono">{String(placedOrderId).slice(-8).toUpperCase()}</strong></p>
                      <p className="text-muted-foreground text-xs">You'll receive an email at <strong>{email}</strong> when your payment is verified.</p>
                    </div>
                    <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm text-blue-900">
                      <p className="font-semibold mb-1">📋 What happens next?</p>
                      <ul className="text-xs space-y-1 list-disc list-inside">
                        <li>Our team will verify your payment screenshot</li>
                        <li>If flagged for review, you'll be notified within 24 hours</li>
                        <li>Once approved, your order will be prepared for pickup</li>
                      </ul>
                    </div>
                    <div className="flex gap-3 justify-center flex-wrap">
                      <Button variant="outline" onClick={() => { resetOrder(); setTab('track'); }}>
                        <Clock className="h-4 w-4 mr-1" /> Track This Order
                      </Button>
                      <Button onClick={resetOrder}>Place Another Order</Button>
                    </div>
                  </div>
                )}

              </motion.div>
            </AnimatePresence>
          </>
        )}
      </div>
      <Footer />
    </div>
  );
}
