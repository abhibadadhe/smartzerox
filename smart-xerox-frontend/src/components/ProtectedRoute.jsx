import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

// Each role has their own home dashboard
const roleDashboard = {
  user:        '/dashboard',
  shopkeeper:  '/shop',
  admin:       '/admin',
};

const ProtectedRoute = ({ children, roles }) => {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Not logged in → go to login
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // Wrong role → redirect to their own correct dashboard
  if (roles && user && !roles.includes(user.role)) {
    const redirect = roleDashboard[user.role] || '/dashboard';
    return <Navigate to={redirect} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;