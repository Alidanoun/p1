import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

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
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-background gap-4 px-4 text-center">
        <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mb-2">
          <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-text-main">غير مصرح بالوصول</h3>
        <p className="text-text-muted text-sm max-w-md">
          حسابك لا يمتلك صلاحية الكافية للوصول إلى هذه الصفحة ({permission}). يرجى التواصل مع الإدارة أو تسجيل الخروج.
        </p>
        <button 
          onClick={() => {
            // Clear cache and redirect to login
            localStorage.removeItem('selectedBranchId');
            sessionStorage.removeItem('selectedBranchId');
            window.location.href = '/login';
          }}
          className="mt-4 px-6 py-2 rounded-xl bg-primary text-primary-foreground font-bold hover:bg-primary-hover transition-all text-sm"
        >
          العودة لتسجيل الدخول
        </button>
      </div>
    );
  }

  return children;
};

export default ProtectedRoute;
