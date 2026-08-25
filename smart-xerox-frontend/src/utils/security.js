// ============================================
// FRONTEND SECURITY UTILITIES
// ============================================

import CryptoJS from 'crypto-js';

/**
 * Generate CSRF token for requests
 */
export const generateCsrfToken = () => {
  return CryptoJS.lib.WordArray.random(32).toString();
};

/**
 * Get CSRF token from cookie
 */
export const getCsrfToken = () => {
  const match = document.cookie.match(/csrf-token=([^;]+)/);
  return match ? match[1] : null;
};

/**
 * Sanitize user input to prevent XSS
 */
export const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

/**
 * Validate email format
 */
export const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate phone number (Indian format)
 */
export const isValidPhone = (phone) => {
  const phoneRegex = /^[6-9]\d{9}$/;
  return phoneRegex.test(phone);
};

/**
 * Check password strength
 */
export const checkPasswordStrength = (password) => {
  const strength = {
    score: 0,
    feedback: [],
  };
  
  if (password.length < 8) {
    strength.feedback.push('Password must be at least 8 characters');
    return strength;
  }
  
  if (password.length >= 8) strength.score += 25;
  if (password.length >= 12) strength.score += 25;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength.score += 25;
  if (/\d/.test(password)) strength.score += 15;
  if (/[^a-zA-Z0-9]/.test(password)) strength.score += 10;
  
  if (strength.score < 50) {
    strength.feedback.push('Weak password. Add uppercase, numbers, and symbols.');
  } else if (strength.score < 75) {
    strength.feedback.push('Fair password. Consider making it longer.');
  } else {
    strength.feedback.push('Strong password!');
  }
  
  return strength;
};

/**
 * Generate secure random string
 */
export const generateRandomString = (length = 32) => {
  return CryptoJS.lib.WordArray.random(length).toString();
};

/**
 * Hash data (client-side, for fingerprinting)
 */
export const hashData = (data) => {
  return CryptoJS.SHA256(data).toString();
};

/**
 * Generate device fingerprint
 */
export const generateDeviceFingerprint = () => {
  const data = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    screenResolution: `${screen.width}x${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    colorDepth: screen.colorDepth,
  };
  
  return hashData(JSON.stringify(data));
};

/**
 * Detect if running in secure context
 */
export const isSecureContext = () => {
  return window.isSecureContext || window.location.protocol === 'https:';
};

/**
 * Validate file upload
 */
export const validateFileUpload = (file, options = {}) => {
  const {
    maxSize = 50 * 1024 * 1024, // 50MB default
    allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'],
  } = options;
  
  const errors = [];
  
  if (file.size > maxSize) {
    errors.push(`File size exceeds ${maxSize / (1024 * 1024)}MB limit`);
  }
  
  if (!allowedTypes.includes(file.type)) {
    errors.push(`File type ${file.type} not allowed`);
  }
  
  // Check for suspicious file names
  if (/[<>:"|?*]/.test(file.name)) {
    errors.push('File name contains invalid characters');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Secure localStorage wrapper
 */
export const secureStorage = {
  set: (key, value) => {
    try {
      const encrypted = CryptoJS.AES.encrypt(
        JSON.stringify(value),
        'your-encryption-key' // In production, use a proper key management
      ).toString();
      localStorage.setItem(key, encrypted);
    } catch (error) {
      console.error('Storage encryption failed:', error);
    }
  },
  
  get: (key) => {
    try {
      const encrypted = localStorage.getItem(key);
      if (!encrypted) return null;
      
      const decrypted = CryptoJS.AES.decrypt(
        encrypted,
        'your-encryption-key'
      ).toString(CryptoJS.enc.Utf8);
      
      return JSON.parse(decrypted);
    } catch (error) {
      console.error('Storage decryption failed:', error);
      return null;
    }
  },
  
  remove: (key) => {
    localStorage.removeItem(key);
  },
  
  clear: () => {
    localStorage.clear();
  },
};

/**
 * Prevent clickjacking
 */
export const preventClickjacking = () => {
  if (window.top !== window.self) {
    window.top.location = window.self.location;
  }
};

/**
 * Content Security Policy violation reporter
 */
export const reportCSPViolation = (violation) => {
  fetch('/api/security/csp-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(violation),
  }).catch(() => {
    // Silently fail
  });
};

/**
 * Rate limit client-side requests
 */
class RateLimiter {
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }
  
  canMakeRequest() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      return false;
    }
    
    this.requests.push(now);
    return true;
  }
  
  reset() {
    this.requests = [];
  }
}

export const apiRateLimiter = new RateLimiter(100, 60000); // 100 requests per minute

/**
 * Detect suspicious activity
 */
export const detectSuspiciousActivity = () => {
  const suspicious = [];
  
  // Check for developer tools
  if (
    window.outerWidth - window.innerWidth > 160 ||
    window.outerHeight - window.innerHeight > 160
  ) {
    suspicious.push('Developer tools may be open');
  }
  
  // Check for automation
  if (navigator.webdriver) {
    suspicious.push('Automated browser detected');
  }
  
  // Check for unusual screen size
  if (screen.width < 320 || screen.height < 320) {
    suspicious.push('Unusual screen size');
  }
  
  return suspicious;
};

/**
 * Initialize security measures
 */
export const initializeSecurity = () => {
  // Prevent clickjacking
  preventClickjacking();
  
  // Disable right-click in production
  if (import.meta.env.PROD) {
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }
  
  // Disable F12 and other dev shortcuts in production
  if (import.meta.env.PROD) {
    document.addEventListener('keydown', (e) => {
      if (
        e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && e.key === 'I') ||
        (e.ctrlKey && e.shiftKey && e.key === 'J') ||
        (e.ctrlKey && e.key === 'U')
      ) {
        e.preventDefault();
      }
    });
  }
  
  // Monitor for suspicious activity
  setInterval(() => {
    const suspicious = detectSuspiciousActivity();
    if (suspicious.length > 0) {
      console.warn('Suspicious activity detected:', suspicious);
    }
  }, 30000); // Check every 30 seconds
  
  console.log('🔒 Security measures initialized');
};

export default {
  sanitizeInput,
  isValidEmail,
  isValidPhone,
  checkPasswordStrength,
  generateRandomString,
  hashData,
  generateDeviceFingerprint,
  isSecureContext,
  validateFileUpload,
  secureStorage,
  preventClickjacking,
  reportCSPViolation,
  apiRateLimiter,
  detectSuspiciousActivity,
  initializeSecurity,
};
