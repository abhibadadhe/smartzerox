
import { Link } from 'react-router-dom';

const Footer = () => (
  <footer className="border-t border-border/50 bg-card/50">
    <div className="container mx-auto px-4 py-12">
      <div className="grid gap-8 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <img src="/logo.png" alt="Pratibimb" className="h-10 w-auto object-contain" />
          </div>
          <p className="text-sm text-muted-foreground">
            Upload, print, and pick up documents from nearby xerox shops with ease.
          </p>
        </div>
        <div>
          <h4 className="font-heading font-semibold mb-3">Quick Links</h4>
          <div className="flex flex-col gap-2">
            <Link to="/services" className="text-sm text-muted-foreground hover:text-foreground">Services</Link>
            <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">Sign In</Link>
            <Link to="/register" className="text-sm text-muted-foreground hover:text-foreground">Register</Link>
          </div>
        </div>
        <div>
          <h4 className="font-heading font-semibold mb-3">Services</h4>
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">Document Printing</span>
            <span className="text-sm text-muted-foreground">Color Xerox</span>
            <span className="text-sm text-muted-foreground">Stationery</span>
          </div>
        </div>
        <div>
          <h4 className="font-heading font-semibold mb-3">Support</h4>
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">help@smartxerox.com</span>
            <span className="text-sm text-muted-foreground">+91 98765 43210</span>
          </div>
        </div>
      </div>
      <div className="mt-8 border-t border-border/50 pt-6 text-center text-sm text-muted-foreground">
        © 2026 Pratibimb. All rights reserved.
      </div>
    </div>
  </footer>
);

export default Footer;
