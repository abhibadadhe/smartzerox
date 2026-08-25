import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const kitApi = axios.create({ baseURL: API_BASE });

kitApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const kitAPI = {
  // Catalog
  getYears:        ()                 => kitApi.get('/kit/years'),
  getColleges:     ()                 => kitApi.get('/kit/colleges'),
  getCollegeParts: (college)          => kitApi.get('/kit/college-parts', { params: { college } }),
  getDepartments:  ()                 => kitApi.get('/kit/departments'),
  getSubjects:     (year, dept)       => kitApi.get('/kit/subjects', { params: { year, department: dept } }),
  getNotes:        (subject)          => kitApi.get('/kit/notes', { params: { subject } }),

  // Orders
  createOrder:     (formData)         => kitApi.post('/kit/create-order', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  getMyOrders:     (email, phone)     => kitApi.get('/kit/my-orders', { params: { email, phone } }),
  getOrderStatus:  (id, email, phone) => kitApi.get(`/kit/order/${id}`, { params: { email, phone } }),

  // Shopkeeper
  getKitOrders:         (params) => kitApi.get('/kit/shopkeeper/kit-orders', { params }),
  getSuspiciousOrders:  (params) => kitApi.get('/kit/shopkeeper/suspicious-orders', { params }),  // Fix #15
  getFraudStats:        ()       => kitApi.get('/kit/shopkeeper/fraud-stats'),                     // Fix #15
  getOrderCounts:       ()       => kitApi.get('/kit/shopkeeper/order-counts'),                    // Fix #14
  updateKitOrderStatus: (id, status, note) =>
    kitApi.patch(`/kit/shopkeeper/kit-order/${id}/status`, { status, note }),
};
