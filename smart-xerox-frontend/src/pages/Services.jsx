import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Printer, FileText, Palette, BookOpen, Package, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

const services = [
  { icon: FileText, title: 'B&W Printing', desc: 'Standard black and white document printing at affordable prices.', price: 'From ₹1/page' },
  { icon: Palette, title: 'Color Printing', desc: 'High-quality color prints for presentations and projects.', price: 'From ₹5/page' },
  { icon: Printer, title: 'Xerox / Photocopy', desc: 'Quick photocopies with single or double-sided options.', price: 'From ₹0.50/page' },
  { icon: BookOpen, title: 'Binding & Spiral', desc: 'Professional binding for reports, theses, and books.', price: 'From ₹30' },
  { icon: Package, title: 'Stationery', desc: 'Office supplies, pens, notebooks, and more.', price: 'Varies' },
  { icon: Scissors, title: 'Lamination', desc: 'Protect documents with lamination services.', price: 'From ₹10/page' },
];

const Services = () => (
  <div className="min-h-screen">
    <Navbar />
    <div className="container mx-auto px-4 py-16">
      <div className="text-center mb-12">
        <h1 className="font-heading text-4xl font-bold">Our Services</h1>
        <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
          We offer a wide range of printing and stationery services at competitive prices
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {services.map((s, i) => (
          <motion.div
            key={s.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08 }}
            className="glass-card p-6 group hover:sunrise-shadow-sm transition-all"
          >
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-secondary group-hover:sunrise-gradient group-hover:text-primary-foreground transition-all">
              <s.icon className="h-6 w-6" />
            </div>
            <h3 className="font-heading text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
            <div className="mt-4 text-sm font-semibold text-primary">{s.price}</div>
          </motion.div>
        ))}
      </div>
      <div className="mt-12 text-center">
        <Button asChild size="lg" className="sunrise-gradient text-primary-foreground sunrise-shadow-sm">
          <Link to="/register">Get Started Now</Link>
        </Button>
      </div>
    </div>
    <Footer />
  </div>
);

export default Services;
