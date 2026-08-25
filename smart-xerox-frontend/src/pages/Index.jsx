import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Upload, CreditCard, QrCode, Zap, Shield, Clock, MapPin, FileText } from 'lucide-react';import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

const features = [
  { icon: Upload, title: 'Upload Documents', desc: 'Upload PDFs securely to the cloud in seconds.' },
  { icon: FileText, title: 'Select Options', desc: 'Choose color, copies, paper size, and binding.' },
  { icon: CreditCard, title: 'Pay Online', desc: 'Secure Razorpay payment with instant confirmation.' },
  { icon: QrCode, title: 'QR Pickup', desc: 'Show QR code at the shop for instant pickup.' },
  { icon: Zap, title: 'Real-Time Tracking', desc: 'Track your order status live via Socket.IO.' },
  { icon: MapPin, title: 'Nearby Shops', desc: 'Find the closest xerox shops with best pricing.' },
];

const steps = [
  { num: '01', title: 'Upload', desc: 'Upload your PDF document' },
  { num: '02', title: 'Configure', desc: 'Select print options & shop' },
  { num: '03', title: 'Pay', desc: 'Pay securely via Razorpay' },
  { num: '04', title: 'Pickup', desc: 'Show QR code & collect prints' },
];

const Index = () => {
  return (
    <div className="min-h-screen">
      <Navbar />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-sunrise-from/30 via-sunrise-via/20 to-transparent blur-3xl" />
          <div className="absolute -bottom-40 -left-40 h-[400px] w-[400px] rounded-full bg-gradient-to-tr from-sunrise-to/20 via-sunrise-via/10 to-transparent blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-gradient-to-r from-sunrise-from/10 via-sunrise-via/5 to-sunrise-to/10 blur-3xl animate-pulse-slow" />
        </div>

        <div className="container relative mx-auto px-4 py-20 md:py-32">
          <div className="mx-auto max-w-4xl text-center">
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-sm font-medium text-secondary-foreground">
                <Zap className="h-4 w-4" />
                Pratibimb — Smart Printing Made Easy
              </div>
              <h1 className="font-heading text-4xl font-bold leading-tight md:text-6xl lg:text-7xl">
                Print Documents{' '}
                <span className="sunrise-gradient-text">Anywhere,</span>
                <br />
                Pickup{' '}
                <span className="sunrise-gradient-text">Nearby</span>
              </h1>              <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
                Upload your documents, pay online, and collect prints from the nearest xerox shop.
                Real-time tracking with QR verification.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Button asChild size="lg" className="sunrise-gradient text-primary-foreground sunrise-shadow px-8 text-base">
                  <Link to="/register">Start Printing</Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="px-8 text-base">
                  <Link to="/services">Browse Services</Link>
                </Button>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="mt-16 grid grid-cols-2 gap-6 md:grid-cols-4"
            >
              {[
                { value: '500+', label: 'Shops' },
                { value: '10K+', label: 'Users' },
                { value: '50K+', label: 'Orders' },
                { value: '99.9%', label: 'Uptime' },
              ].map((stat) => (
                <div key={stat.label} className="glass-card p-4 sunrise-shadow-sm hover-lift cursor-default animate-glow-pulse" style={{ animationDelay: `${['0s','0.8s','1.6s','2.4s'][['Shops','Users','Orders','Uptime'].indexOf(stat.label)]}` }}>
                  <div className="font-heading text-2xl font-bold sunrise-gradient-text">{stat.value}</div>
                  <div className="text-sm text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border/50 bg-card/50 py-20">
        <div className="container mx-auto px-4">
          <div className="mb-12 text-center">
            <h2 className="font-heading text-3xl font-bold md:text-4xl">How It Works</h2>
            <p className="mt-3 text-muted-foreground">Four simple steps to get your documents printed</p>
          </div>
          <div className="grid gap-8 md:grid-cols-4">
            {steps.map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="relative text-center"
              >
                <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl sunrise-gradient text-primary-foreground font-heading text-xl font-bold sunrise-shadow-sm">
                  {step.num}
                </div>
                <h3 className="font-heading text-lg font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="mb-12 text-center">
            <h2 className="font-heading text-3xl font-bold md:text-4xl">Powerful Features</h2>
            <p className="mt-3 text-muted-foreground">Everything you need for seamless document printing</p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="glass-card p-6 hover-lift cursor-default"
              >
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
                  <f.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-heading text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="border-t border-border/50 bg-card/50 py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
              <Shield className="h-7 w-7 text-primary" />
            </div>
            <h2 className="font-heading text-3xl font-bold">Secure &amp; Reliable</h2>
            <p className="mt-4 text-muted-foreground">
              JWT authentication, encrypted file storage on AWS S3, secure Razorpay payments,
              and QR-verified pickups ensure your documents are always safe.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
              {['JWT Auth', 'Encrypted Storage', 'Secure Payments', 'QR Verification'].map((item) => (
                <div key={item} className="rounded-xl bg-secondary px-4 py-3 text-sm font-medium text-secondary-foreground">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="relative overflow-hidden rounded-3xl sunrise-gradient p-12 text-center sunrise-shadow-lg">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary-foreground/5 to-transparent" />
            <div className="relative">
              <h2 className="font-heading text-3xl font-bold text-primary-foreground md:text-4xl">
                Ready to Start Printing?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-primary-foreground/80">
                Join thousands of users who save time with Pratibimb.
              </p>
              <Button asChild size="lg" variant="secondary" className="mt-8 px-8 text-base font-semibold">
                <Link to="/register">Create Free Account</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Index;
