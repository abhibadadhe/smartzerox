import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Log API configuration on startup (production debugging)
if (import.meta.env.MODE === 'production') {
  console.info(`📡 API Configuration: ${API_BASE}`);
  if (!import.meta.env.VITE_API_URL) {
    console.warn('⚠️ VITE_API_URL not set in environment. Using fallback: http://localhost:5000/api');
  }
}

// ── CRITICAL FIX: Add timeout and retry configuration ──────────────────────
// ✅ PRODUCTION FIX: Increased timeout for bulk orders (large file uploads)
const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 60000, // 60 second timeout for bulk orders (was 30s)
  withCredentials: true,
});

// ✅ PRODUCTION FIX: Dynamic timeout based on request type
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  // ✅ PRODUCTION FIX: Increase timeout for file uploads (bulk orders)
  if (config.url?.includes('/upload')) {
    config.timeout = 120000; // 2 minutes for file uploads
  }
  
  // ✅ PRODUCTION FIX: Increase timeout for order creation (may process many documents)
  if (config.method?.toUpperCase() === 'POST' && config.url === '/orders') {
    config.timeout = 90000; // 90 seconds for order creation
  }
  
  // Idempotency key — stable per checkout attempt (set by caller or generated once)
  if (['POST', 'PATCH', 'DELETE'].includes(config.method?.toUpperCase())) {
    if (
      config.url?.includes('/payments/') ||
      config.url?.includes('/refund') ||
      (config.method?.toUpperCase() === 'POST' && config.url === '/orders')
    ) {
      if (!config.headers['Idempotency-Key']) {
        // ✅ PRODUCTION FIX: Generate stable idempotency key for retry safety
        config.headers['Idempotency-Key'] = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }
    }
  }
  
  return config;
});

// ── Retry logic for failed requests ────────────────────────────────────────
// ✅ PRODUCTION FIX: Enhanced retry configuration for bulk orders
const retryConfig = {
  maxRetries: 3,
  retryDelay: 2000, // Start with 2 seconds (was 1s)
  retryableStatuses: [408, 429, 500, 502, 503, 504], // Timeout, rate limit, server errors
};

api.interceptors.response.use(
  (res) => {
    // Pick up silently rotated tokens issued by the backend auth middleware
    const newToken   = res.headers['x-new-token'];
    const newRefresh = res.headers['x-refresh-token'];
    if (newToken)   localStorage.setItem('token', newToken);
    if (newRefresh) localStorage.setItem('refreshToken', newRefresh);

    // ✅ PRODUCTION FIX: Log successful bulk operations in development
    if (import.meta.env.MODE === 'development') {
      const method = res.config.method?.toUpperCase();
      const url = res.config.url || '';
      const isLargeRequest = res.config.data && JSON.stringify(res.config.data).length > 10000;
      
      if (isLargeRequest) {
        console.debug(`✅ ${method} ${url} → ${res.status} (large payload)`);
      } else {
        console.debug(`✅ ${method} ${url} → ${res.status}`);
      }
    }
    return res;
  },
  async (error) => {
    const config = error.config;

    // Initialize retry count
    if (!config.retryCount) {
      config.retryCount = 0;
    }

    // Determine if request should be retried
    const method = config.method?.toUpperCase();
    const url = config.url || '';
    const isMutatingOrderOrPayment =
      method === 'POST' && (url.includes('/orders') || url.includes('/payments/'));
    const shouldRetry =
      !isMutatingOrderOrPayment &&
      config.retryCount < retryConfig.maxRetries &&
      (error.code === 'ECONNABORTED' || // Timeout
        error.code === 'ENOTFOUND' || // DNS failure
        (error.response && retryConfig.retryableStatuses.includes(error.response.status)));

    if (shouldRetry) {
      config.retryCount++;
      const delay = retryConfig.retryDelay * Math.pow(2, config.retryCount - 1); // Exponential backoff
      console.warn(`🔄 Request failed. Retrying in ${delay}ms (attempt ${config.retryCount}/${retryConfig.maxRetries})`);
      console.warn(`   ${method} ${url} - ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return api(config);
    }

    // ✅ FIX #13: Handle 401 — redirect to login only if not already on login page
    if (error.response?.status === 401) {
      console.warn('❌ Authentication failed (401). Redirecting to login.');
      
      // ✅ FIX #13: Prevent redirect loop by checking current location
      const isAuthPage = window.location.pathname === '/login' || 
                         window.location.pathname === '/register' ||
                         window.location.pathname === '/forgot-password' ||
                         window.location.pathname === '/verify-email';
      
      if (!isAuthPage) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('refreshToken');
        
        // Disconnect socket before redirect to prevent stale connections
        try {
          import('./socket').then(({ disconnectSocket }) => disconnectSocket()).catch(() => {});
        } catch (e) {
          // Socket module might not exist
        }
        
        window.location.href = '/login?reason=session-expired';
      }
    }

    // Log errors in development
    if (import.meta.env.MODE === 'development') {
      console.error(`❌ ${method} ${url} - ${error.response?.status || error.code || error.message}`);
      console.error(`   Response:`, error.response?.data || error.message);
    }

    return Promise.reject(error);
  }
);

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  return config;
});

// Auth
export const authAPI = {
  register:        (data)  => api.post('/auth/register', data),
  login:           (data)  => api.post('/auth/login', data),
  verifyOTP:       (data)  => api.post('/auth/verify-otp', data),
  verifyEmail:     (data)  => api.post('/auth/verify-email', data),
  resendOTP:       (data)  => api.post('/auth/resend-otp', data),
  // FIX: was /auth/profile (route does not exist) — correct route is /auth/me
  getMe:           ()      => api.get('/auth/me'),
  getProfile:      ()      => api.get('/auth/me'),
  forgotPassword:  (email) => api.post('/auth/forgot-password', { email }),
  resetPassword:   (data)  => api.post('/auth/reset-password', data),
  logout:          ()      => api.post('/auth/logout'),
};

// User Profile
export const userAPI = {
  getProfile:           ()      => api.get('/users/profile'),
  updateProfile:        (data)  => api.patch('/users/profile', data),
  requestContactChange: (data)  => api.post('/users/request-change', data),
  verifyContactChange:  (data)  => api.post('/users/verify-change', data),
  getStats:             ()      => api.get('/users/stats'),
  getOrderHistory:      ()      => api.get('/users/orders'),
  changeShop:           (shopId) => api.patch('/users/change-shop', { shopId }),
};

// Orders
export const orderAPI = {
  // Order is created with JSON body (documents array with S3 urls, NOT FormData)
  create:          (data, axiosConfig) => api.post('/orders', data, axiosConfig),
  getAll:          ()              => api.get('/orders'),
  getById:         (id)            => api.get(`/orders/${id}`),
  // FIX: was api.put — backend route is PATCH
  updateStatus:    (id, status)    => api.patch(`/orders/${id}/status`, { status }),
  cancel:          (id)            => api.delete(`/orders/${id}`),
  getMyOrders:     ()              => api.get('/orders/my-orders'),
  // FIX: was api.post('/orders/:id/verify-pickup') — backend route is POST /orders/verify-pickup with orderId in body
  verifyPickup:    (data)          => api.post('/orders/verify-pickup', data),
  retryPayment:    (id)            => api.post(`/orders/retry/${id}`),
  resumePrint:     (id)            => api.post(`/orders/${id}/resume-print`),
  triggerPrint:    (id)            => api.post(`/orders/${id}/trigger-print`),
  getPrintJob:     (id)            => api.get(`/orders/${id}/print-job`),
  extendExpiry:    (id)            => api.post(`/orders/${id}/extend`),
  // FIX: added missing accept / reject / getDocumentUrl
  accept:          (id)            => api.patch(`/orders/${id}/accept`),
  reject:          (id, reason)    => api.patch(`/orders/${id}/reject`, { reason }),
  getDocumentUrl:  (orderId, docId)=> api.get(`/orders/${orderId}/documents/${docId}/url`),
};

// Shops
export const shopAPI = {
  getAll:          ()      => api.get('/shops'),
  getById:         (id)    => api.get(`/shops/${String(id)}`),
  create:          (data)  => api.post('/shops', data),
  update:          (data)  => api.patch('/shops/my-shop', data),
  updateShop:      (data)  => api.patch('/shops/my-shop', data),
  delete:          (id)    => api.delete(`/shops/${id}`),
  // FIX: /shops/my-shop returns full shop object including pricing
  getMyShop:       ()      => api.get('/shops/my-shop'),
  getDashboard:    ()      => api.get('/shops/my-shop/dashboard'),
  updatePricing:   (data)  => api.patch('/shops/my-shop', { pricing: data }),
  toggleStatus:    ()      => api.patch('/shops/my-shop/toggle-status'),
  // FIX: was /shops/orders (404) — correct route is /orders/shop/orders
  getShopOrders:   (query) => api.get(`/orders/shop/orders${query ? `?${query}` : ''}`),
  getWithdrawals:  ()      => api.get('/shops/my-shop/withdrawals'),
  requestWithdrawal: (data) => api.post('/shops/my-shop/withdraw', data),
};

// Printers
export const printerAPI = {
  getShopPrinters:  ()                => api.get('/printers/my-shop'),
  togglePrinter:    (id, isEnabled)   => api.patch(`/printers/${id}/toggle`, { isEnabled }),
  updateDisplayName:(id, displayName) => api.patch(`/printers/${id}/display-name`, { displayName }),
  scanPrinters:     ()                => api.post('/printers/scan'),
  getOptimalPrinter:(type, pages)     => api.get(`/printers/optimal?type=${type}&pages=${pages}`),
  getLoadStats:     ()                => api.get('/printers/load-stats'),
  resetAllPrinters: ()                => api.post('/printers/reset-all'),
  addManualPrinter: (data)            => api.post('/printers/manual', data),
  updateIp:         (id, ipAddress)   => api.patch(`/printers/${id}/ip`, { ipAddress }),
  detectFormats:    (id)              => api.post(`/printers/${id}/detect-formats`),
};

// Payments
export const paymentAPI = {
  // FIX: removed paymentAPI.createOrder — razorpay data comes from orderAPI.create() response
  // Verify uses camelCase field names to match backend expectation
  verify: (data) => api.post('/payments/verify', data),
  getDetails: (orderId) => api.get(`/payments/order/${orderId}`),
  refund: (data) => api.post('/payments/refund', data),
};

// Upload — call this FIRST before placing order to get S3 url
export const uploadAPI = {
  // FIX: was /upload (404) — correct endpoint is /upload/single
  uploadFile: (file, onProgress) => {
    const formData = new FormData();
    formData.append('document', file);
    return api.post('/upload/single', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress
        ? (e) => {
            const pct = e.total ? Math.round((e.loaded * 100) / e.total) : 0;
            onProgress(pct);
          }
        : undefined,
    });
  },
  uploadMultiple: (files, onProgress) => {
    const formData = new FormData();
    files.forEach(f => formData.append('documents', f));
    return api.post('/upload/multiple', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress
        ? (e) => {
            const pct = e.total ? Math.round((e.loaded * 100) / e.total) : 0;
            onProgress(pct);
          }
        : undefined,
    });
  },
  getSignedUrl: (key) => api.get(`/upload/signed-url?key=${key}`),
};

// Notifications
export const notificationAPI = {
  getAll:      ()         => api.get('/notifications'),
  markRead:    (ids)      => api.patch('/notifications/read', { notificationIds: ids }),
  markAllRead: ()         => api.patch('/notifications/read-all'),
  delete:      (id)       => api.delete(`/notifications/${id}`),
  deleteAll:   ()         => api.delete('/notifications'),
};

// Admin
export const adminAPI = {
  getDashboard:  ()        => api.get('/admin/dashboard'),
  getAnalytics:  ()        => api.get('/admin/analytics'),
  getRevenue:    (query)   => api.get(`/admin/revenue${query ? `?${query}` : ''}`),
  getUsers:      (query)   => api.get(`/admin/users${query ? `?${query}` : ''}`),
  toggleUser:    (id)      => api.patch(`/admin/users/${id}/toggle-status`),
  getShops:      (query)   => api.get(`/admin/shops${query ? `?${query}` : ''}`),
  verifyShop:    (id, data)=> api.patch(`/admin/shops/${id}/verify`, data),
  setMargin:     (id, data)=> api.patch(`/admin/shops/${id}/margin`, data),
  getOrders:     (query)   => api.get(`/admin/orders${query ? `?${query}` : ''}`),
  broadcast:     (data)    => api.post('/admin/notifications/broadcast', data),
  // Commission settings
  getCommission:          ()     => api.get('/admin/commission'),
  updateCommission:       (data) => api.patch('/admin/commission', data),
  applyCommissionToAll:   (data) => api.post('/admin/commission/apply-all', data),
  // System Announcement & Maintenance Broadcast
  getAnnouncement:        ()     => api.get('/admin/announcement'),
  getPublicAnnouncement:  ()     => api.get('/admin/announcement/public'),
  updateAnnouncement:     (data) => api.post('/admin/announcement', data),
};

export default api;
