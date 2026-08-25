import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { authAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mail, Lock, Eye, EyeOff, ShieldCheck, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

// step: 'login' | 'otp' | 'forgot' | 'reset'
const Login = () => {
  const { login, verifyOTP } = useAuth();
  const navigate = useNavigate();

  const [step, setStep]               = useState('login');
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [otp, setOtp]                 = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]         = useState(false);

  // ── Role-based redirect ────────────────────────────────────────────────────
  const getRoleRedirect = (role) => {
    if (role === 'admin')      return '/admin';
    if (role === 'shopkeeper') return '/shop';
    return '/dashboard';
  };

  // ── Login ──────────────────────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result?.requiresOTP) {
        setStep('otp');
        toast.info('OTP sent to your email');
      } else {
        toast.success('Login successful!');
        // Read role from localStorage (set by login function in AuthContext)
        const stored = localStorage.getItem('user');
        const u = stored ? JSON.parse(stored) : null;
        navigate(getRoleRedirect(u?.role));
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  // ── Verify OTP (phone login) ───────────────────────────────────────────────
  const handleOTP = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await verifyOTP(email, otp);
      toast.success('Verified successfully!');
      const stored = localStorage.getItem('user');
      const u = stored ? JSON.parse(stored) : null;
      navigate(getRoleRedirect(u?.role));
    } catch (err) {
      toast.error(err.response?.data?.message || 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot Password — Step 1: Send OTP ────────────────────────────────────
  const handleForgotSend = async (e) => {
    e.preventDefault();
    if (!email) { toast.error('Enter your email first'); return; }
    setLoading(true);
    try {
      await authAPI.forgotPassword(email);
      toast.success('OTP sent to your email!');
      setStep('reset');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Email not found');
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot Password — Step 2: Reset with OTP ──────────────────────────────
  const handleReset = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authAPI.resetPassword({ email, otp, newPassword });
      toast.success('Password reset successfully! Please login.');
      setStep('login');
      setOtp('');
      setNewPassword('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid OTP or password too weak');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 sunrise-gradient items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20" />
        <div className="relative text-center p-12">
          <img src="/logo.png" alt="Pratibimb" className="h-28 w-auto object-contain mx-auto mb-6 drop-shadow-xl" />
          <h2 className="font-heading text-4xl font-bold text-primary-foreground">Pratibimb</h2>
          <p className="mt-4 text-lg text-primary-foreground/80 max-w-md">Your one-stop platform for online document printing and pickup</p>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex w-full items-center justify-center px-4 lg:w-1/2">
        <div className="w-full max-w-md">

          {/* Back to Home Button */}
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            Back to Home
          </Link>

          {/* Mobile logo */}
          <div className="mb-8 lg:hidden flex items-center gap-2">
            <img src="/logo.png" alt="Pratibimb" className="h-10 w-auto object-contain" />
          </div>

          <AnimatePresence mode="wait">

            {/* ── Login Form ── */}
            {step === 'login' && (
              <motion.div key="login" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h1 className="font-heading text-3xl font-bold">Welcome Back</h1>
                <p className="mt-2 text-muted-foreground">Sign in to your account</p>
                <form onSubmit={handleLogin} className="mt-8 space-y-5">
                  <div>
                    <Label>Email</Label>
                    <div className="relative mt-1.5">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} className="pl-10" required />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label>Password</Label>
                      <button type="button" onClick={() => setStep('forgot')} className="text-xs text-primary hover:underline">Forgot password?</button>
                    </div>
                    <div className="relative mt-1.5">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} className="pl-10 pr-10" required />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full sunrise-gradient text-primary-foreground sunrise-shadow-sm" disabled={loading}>
                    {loading ? 'Signing in...' : 'Sign In'}
                  </Button>
                </form>
                <p className="mt-6 text-center text-sm text-muted-foreground">
                  Don&apos;t have an account?{' '}
                  <Link to="/register" className="font-medium text-primary hover:underline">Sign up</Link>
                </p>
              </motion.div>
            )}

            {/* ── OTP Step (phone login) ── */}
            {step === 'otp' && (
              <motion.div key="otp" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div className="flex justify-center mb-6">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl sunrise-gradient"><ShieldCheck className="h-8 w-8 text-primary-foreground" /></div>
                </div>
                <h1 className="font-heading text-3xl font-bold text-center">Enter OTP</h1>
                <p className="mt-2 text-muted-foreground text-center">OTP sent to <span className="font-semibold text-primary">{email}</span></p>
                <form onSubmit={handleOTP} className="mt-8 space-y-5">
                  <Input type="text" inputMode="numeric" maxLength={6} placeholder="• • • • • •" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                    className="text-center text-2xl font-bold tracking-[0.5em] h-14" required autoFocus />
                  <Button type="submit" className="w-full sunrise-gradient text-primary-foreground" disabled={loading || otp.length !== 6}>
                    {loading ? 'Verifying...' : 'Verify & Login'}
                  </Button>
                </form>
                <button onClick={() => setStep('login')} className="mt-4 text-sm text-muted-foreground hover:text-foreground w-full text-center">← Back to login</button>
              </motion.div>
            )}

            {/* ── Forgot Password Step 1 ── */}
            {step === 'forgot' && (
              <motion.div key="forgot" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h1 className="font-heading text-3xl font-bold">Reset Password</h1>
                <p className="mt-2 text-muted-foreground">Enter your email to receive a reset OTP</p>
                <form onSubmit={handleForgotSend} className="mt-8 space-y-5">
                  <div>
                    <Label>Email Address</Label>
                    <div className="relative mt-1.5">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} className="pl-10" required />
                    </div>
                  </div>
                  <Button type="submit" className="w-full sunrise-gradient text-primary-foreground" disabled={loading}>
                    {loading ? 'Sending OTP...' : 'Send Reset OTP'}
                  </Button>
                </form>
                <button onClick={() => setStep('login')} className="mt-4 text-sm text-muted-foreground hover:text-foreground w-full text-center">← Back to login</button>
              </motion.div>
            )}

            {/* ── Reset Password Step 2 ── */}
            {step === 'reset' && (
              <motion.div key="reset" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div className="flex justify-center mb-6">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl sunrise-gradient"><ShieldCheck className="h-8 w-8 text-primary-foreground" /></div>
                </div>
                <h1 className="font-heading text-3xl font-bold text-center">Set New Password</h1>
                <p className="mt-2 text-muted-foreground text-center">OTP sent to <span className="font-semibold text-primary">{email}</span></p>
                <form onSubmit={handleReset} className="mt-8 space-y-4">
                  <div>
                    <Label>6-Digit OTP</Label>
                    <Input type="text" inputMode="numeric" maxLength={6} placeholder="• • • • • •" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                      className="mt-1.5 text-center text-xl font-bold tracking-[0.5em] h-12" required autoFocus />
                  </div>
                  <div>
                    <Label>New Password</Label>
                    <div className="relative mt-1.5">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input type={showPassword ? 'text' : 'password'} placeholder="Min 8 chars with letters and numbers" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="pl-10 pr-10" required minLength={8} />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full sunrise-gradient text-primary-foreground" disabled={loading || otp.length !== 6 || !newPassword}>
                    {loading ? 'Resetting...' : 'Reset Password'}
                  </Button>
                </form>
                <button onClick={() => setStep('forgot')} className="mt-4 text-sm text-muted-foreground hover:text-foreground w-full text-center">← Back</button>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default Login;