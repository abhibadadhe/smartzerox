import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '@/lib/api';
import { disconnectSocket } from '@/lib/socket';

const AuthContext = createContext(undefined);

export const AuthProvider = ({ children }) => {
  const [user, setUser]       = useState(null);
  const [token, setToken]     = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      authAPI.getMe()
        .then((res) => setUser(res.data.data?.user || res.data.user || res.data))
        .catch((err) => {
          // Silently fail on network errors during initial load
          if (err.code !== 'ERR_NETWORK') {
            localStorage.removeItem('token');
            setToken(null);
          }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  // Login
  const login = async (email, password) => {
    const res = await authAPI.login({ email, password });
    if (res.data.data?.requiresOTP || res.data.requiresOTP) return { requiresOTP: true };
    const { token: newToken, user: newUser } = res.data.data || res.data;
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    return {};
  };

  // Register Step 1 — creates user + sends OTP email, no token yet
  const register = async (data) => {
    await authAPI.register(data);
  };

  // Register Step 2 — verifies OTP, backend returns token + auto login
  const verifyEmail = async (email, otp) => {
    const res = await authAPI.verifyEmail({ email, otp });
    const { token: newToken, user: newUser } = res.data.data || res.data;
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  // OTP login (phone-based)
  const verifyOTP = async (email, otp) => {
    const res = await authAPI.verifyOTP({ email, otp });
    const { token: newToken, user: newUser } = res.data.data || res.data;
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  // Resend registration OTP
  const resendOTP = async (email) => {
    await authAPI.resendOTP({ email });
  };

  // Logout
  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    disconnectSocket();
  };

  // Update user state globally (e.g. after shop change)
  const updateUser = (updatedUser) => {
    if (updatedUser) {
      localStorage.setItem('user', JSON.stringify(updatedUser));
      setUser(updatedUser);
    }
  };

  return (
    <AuthContext.Provider value={{
      user, token, loading,
      login, register, verifyEmail, verifyOTP, resendOTP, logout, updateUser,
      isAuthenticated: !!user,
      isAdmin:         user?.role === 'admin',
      isShopkeeper:    user?.role === 'shopkeeper',
      isUser:          user?.role === 'user',
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};