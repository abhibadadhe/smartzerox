import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mail, Lock, User, Phone, Eye, EyeOff, ShieldCheck, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

const Register = () => {
  const { register, verifyEmail, resendOTP } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '', email: '', password: '', phone: '', role: 'user',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [step, setStep]                 = useState('register'); // 'register' | 'verify'
  const [otp, setOtp]                   = useState('');
  const [verifying, setVerifying]       = useState(false);
  const [resending, setResending]       = useState(false);

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  // Step 1 — Submit registration → backend sends OTP email
  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await register(form);
      toast.success(`OTP sent to ${form.email}! Check your inbox.`);
      setStep('verify');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  // Step 2 — Verify OTP → backend verifies + returns token → auto login
  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    if (otp.length !== 6) {
      toast.error('Please enter the 6-digit OTP');
      return;
    }
    setVerifying(true);
    try {
      await verifyEmail(form.email, otp);
      toast.success('Email verified! Welcome to Pratibimb 🎉');
      const stored = localStorage.getItem('user');
      const u = stored ? JSON.parse(stored) : null;
      const dest = u?.role === 'shopkeeper' ? '/shop' : u?.role === 'admin' ? '/admin' : '/dashboard';
      navigate(dest);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid or expired OTP');
    } finally {
      setVerifying(false);
    }
  };

  // Resend OTP — calls dedicated resendOTP endpoint (not register again)
  const handleResend = async () => {
    setResending(true);
    try {
      await resendOTP(form.email);
      toast.success('New OTP sent to your email!');
      setOtp('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to resend OTP. Try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left gradient panel */}
      <div className="hidden lg:flex lg:w-1/2 sunrise-gradient items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20" />
        <div className="relative text-center p-12">
          <img src="/logo.png" alt="Pratibimb" className="h-28 w-auto object-contain mx-auto mb-6 drop-shadow-xl" />
          <h2 className="font-heading text-4xl font-bold text-primary-foreground">Join Pratibimb</h2>
          <p className="mt-4 text-lg text-primary-foreground/80 max-w-md">
            Create an account and start printing in minutes
          </p>
        </div>
      </div>

      {/* Right form panel */}
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

            {/* ── STEP 1: Registration Form ── */}
            {step === 'register' && (
              <motion.div
                key="register"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <h1 className="font-heading text-3xl font-bold">Create Account</h1>
                <p className="mt-2 text-muted-foreground">Fill in your details to get started</p>

                <form onSubmit={handleRegister} className="mt-8 space-y-4">
                  <div>
                    <Label>Full Name</Label>
                    <div className="relative mt-1.5">
                      <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input placeholder="John Doe" value={form.name} onChange={(e) => update('name', e.target.value)} className="pl-10" required />
                    </div>
                  </div>

                  <div>
                    <Label>Email</Label>
                    <div className="relative mt-1.5">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input type="email" placeholder="you@example.com" value={form.email} onChange={(e) => update('email', e.target.value)} className="pl-10" required />
                    </div>
                  </div>

                  <div>
                    <Label>Phone</Label>
                    <div className="relative mt-1.5">
                      <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input type="tel" placeholder="9876543210" value={form.phone} onChange={(e) => update('phone', e.target.value)} className="pl-10" required />
                    </div>
                  </div>

                  <div>
                    <Label>Password</Label>
                    <div className="relative mt-1.5">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Min 8 chars with letters and numbers"
                        value={form.password}
                        onChange={(e) => update('password', e.target.value)}
                        className="pl-10 pr-10"
                        required
                        minLength={8}
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      At least 8 characters with letters and numbers (e.g. techcrew@123)
                    </p>
                  </div>



                  <Button type="submit" className="w-full sunrise-gradient text-primary-foreground sunrise-shadow-sm" disabled={loading}>
                    {loading ? 'Creating account...' : 'Create Account'}
                  </Button>
                </form>

                <p className="mt-6 text-center text-sm text-muted-foreground">
                  Already have an account?{' '}
                  <Link to="/login" className="font-medium text-primary hover:underline">Sign in</Link>
                </p>
              </motion.div>
            )}

            {/* ── STEP 2: OTP Verification ── */}
            {step === 'verify' && (
              <motion.div
                key="verify"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                {/* Shield icon */}
                <div className="flex justify-center mb-6">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl sunrise-gradient sunrise-shadow-sm">
                    <ShieldCheck className="h-8 w-8 text-primary-foreground" />
                  </div>
                </div>

                <h1 className="font-heading text-3xl font-bold text-center">Verify Your Email</h1>
                <p className="mt-2 text-muted-foreground text-center">
                  We sent a 6-digit OTP to
                </p>
                <p className="font-semibold text-center text-primary mt-1 text-sm">{form.email}</p>

                <form onSubmit={handleVerifyOTP} className="mt-8 space-y-5">
                  <div>
                    <Label className="text-center block">Enter OTP</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="• • • • • •"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                      className="mt-1.5 text-center text-2xl font-bold tracking-[0.5em] h-14"
                      required
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground mt-1.5 text-center">
                      OTP expires in 5 minutes
                    </p>
                  </div>

                  <Button
                    type="submit"
                    className="w-full sunrise-gradient text-primary-foreground sunrise-shadow-sm"
                    disabled={verifying || otp.length !== 6}
                  >
                    {verifying ? 'Verifying...' : 'Verify & Continue'}
                  </Button>
                </form>

                <div className="mt-6 flex flex-col items-center gap-3">
                  <p className="text-sm text-muted-foreground">
                    Didn&apos;t receive the OTP?{' '}
                    <button
                      onClick={handleResend}
                      disabled={resending}
                      className="font-medium text-primary hover:underline disabled:opacity-50"
                    >
                      {resending ? 'Sending...' : 'Resend OTP'}
                    </button>
                  </p>
                  <button
                    onClick={() => { setStep('register'); setOtp(''); }}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    ← Back to registration
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default Register;