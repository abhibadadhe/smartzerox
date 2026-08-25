import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

let socket = null;

// ✅ FIX #14: Track socket authentication state to detect stale sockets
let socketAuthToken = null;

export const getSocket = () => {
  const token = localStorage.getItem('token');
  
  // ✅ FIX #14: If token changed (login/logout), invalidate cached socket
  if (socketAuthToken !== token) {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    socketAuthToken = token;
  }
  
  // ✅ FIX #14: Only create socket if we have a token
  if (!socket && token) {
    socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });
    
    // ✅ FIX #14: Handle auth errors
    socket.on('connect_error', (error) => {
      if (error.message === 'Authentication required' || error.message === 'Invalid token') {
        console.warn('Socket auth failed — clearing token and reconnecting');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        socket.disconnect();
        socket = null;
        socketAuthToken = null;
      }
    });
  }
  
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const joinOrderRoom = (orderId) => {
  const s = getSocket();
  if (!s) return;
  s.emit('join-order', orderId);
};

export const joinShopRoom = (shopId) => {
  const s = getSocket();
  if (!s || !shopId) return;
  s.emit('join:shop', shopId);
  s.once('shop:joined', () => {});
};

export const onShopStatusUpdate = (callback) => {
  const s = getSocket();
  if (!s) return () => {};
  s.on('shop:status_update', callback);
  return () => { s.off('shop:status_update', callback); };
};

export const onOrderUpdate = (callback) => {
  const s = getSocket();
  if (!s) return () => {};
  s.on('order:status_update', callback);
  return () => { s.off('order:status_update', callback); };
};

export const onPaymentSuccess = (callback) => {
  const s = getSocket();
  if (!s) return () => {};
  s.on('payment:success', callback);
  return () => { s.off('payment:success', callback); };
};

export const onNotification = (callback) => {
  const s = getSocket();
  if (!s) return () => {};
  s.on('notification', callback);
  return () => { s.off('notification', callback); };
};

export const onNewOrder = (callback) => {
  const s = getSocket();
  if (!s) return () => {};
  s.on('order:new', callback);
  return () => { s.off('order:new', callback); };
};

export const onPrintStarted = (callback) => {
  const s = getSocket();
  if (!s) return () => {};
  s.on('print:started', callback);
  return () => { s.off('print:started', callback); };
};

export const onPrintCompleted = (callback) => {
  const s = getSocket();
  if (!s) return () => {};
  s.on('print:completed', callback);
  return () => { s.off('print:completed', callback); };
};

export const onPrintProgress = (callback) => {
  const s = getSocket();
  if (!s) return () => {};
  s.on('print:progress', callback);
  return () => { s.off('print:progress', callback); };
};

export const onPrintIssue = (callback) => {
  const s = getSocket();
  if (!s) return () => {};
  s.on('print:issue', callback);
  return () => { s.off('print:issue', callback); };
};

export const onSystemAnnouncement = (callback) => {
  const s = getSocket();
  if (!s) return () => {};
  s.on('system:announcement', callback);
  return () => { s.off('system:announcement', callback); };
};
