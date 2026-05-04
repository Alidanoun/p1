import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * 🛡️ ProtectedRoute Component
 * Enforces both Authentication and Role-Based Authorization (RBAC)
 */
const ProtectedRoute = ({ children, requiredRole, permission }) => {
  const { user, loading, canAccess, isAuthorized } = useAuth();
  const location = useLocation();

  if (loading) return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-background gap-4">
      <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      <p className="text-text-muted text-sm font-medium animate-pulse">جاري التحقق من الصلاحيات...</p>
    </div>
  );

  // 1. Authentication Check
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // 2. Role Authorization Check
  if (requiredRole && !canAccess(requiredRole)) {
    console.warn(`[Security] Unauthorized access attempt to ${location.pathname} by ${user.role}`);
    return <Navigate to="/" replace />; // Redirect to dashboard or forbidden page
  }

  // 3. Granular Permission Check
  if (permission && !isAuthorized(permission)) {
    console.warn(`[Security] Permission denied for ${permission} on ${location.pathname}`);
    return <Navigate to="/" replace />;
  }

  return children;
};

export default ProtectedRoute;
