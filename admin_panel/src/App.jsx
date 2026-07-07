import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { SocketProvider } from './contexts/SocketProvider';
import { ThemeProvider } from './contexts/ThemeProvider';
import { useTheme } from './hooks/useTheme';
import { Toaster } from 'sonner';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import LiveDashboard from './pages/LiveDashboard';
import LiveOrders from './pages/LiveOrders';
import MenuManager from './pages/MenuManager';
import Analytics from './pages/Analytics';
import Reports from './pages/Reports';
import ReportsDashboard from './pages/ReportsDashboard';
import Settings from './pages/Settings';
import BroadcastNotifications from './pages/BroadcastNotifications';
import ReviewsManager from './pages/ReviewsManager';
import CancelledOrders from './pages/CancelledOrders';
import LoyaltyManager from './pages/LoyaltyManager';
import RewardStoreManager from './pages/RewardStoreManager';
import DeliveryZonesManager from './pages/DeliveryZonesManager';
import AuditLog from './pages/AuditLog';
import BranchMenu from './pages/BranchMenu';
import BranchManager from './pages/BranchManager';
import CustomerManager from './pages/CustomerManager';
import DiscountsManager from './pages/DiscountsManager';
import CRMLeads from './pages/CRMLeads';
import CRMPipeline from './pages/CRMPipeline';
import CustomFieldsManager from './pages/CustomFieldsManager';
import ProtectedRoute from './components/ProtectedRoute';
import PinGuard from './components/PinGuard';
import ErrorBoundary from './components/ErrorBoundary';

/**
 * 🏰 Root Protected Layout
 * Persists the Sidebar, Socket Connection, and Theme context across all internal routes.
 * Using <Outlet /> prevents full-page unmounting during navigation.
 */
const ProtectedLayout = () => {
  const { user, loading } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  
  if (loading) return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-background gap-4">
      <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      <p className="text-text-muted text-sm font-medium animate-pulse">جاري استعادة الجلسة...</p>
    </div>
  );
  
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return (
    <SocketProvider>
      <div className="flex bg-background w-full h-screen overflow-hidden text-text-main font-sans selection:bg-primary/20">
        <Sidebar />
        <main className="flex-1 overflow-y-auto overflow-x-hidden relative h-full">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
        
        <Toaster 
          theme={theme} 
          position="top-center" 
          toastOptions={{
            style: {
              background: theme === 'dark' ? '#1e293b' : '#ffffff',
              border: theme === 'dark' ? '1px solid rgba(255, 255, 255, 0.05)' : '1px solid rgba(0, 0, 0, 0.05)',
              color: theme === 'dark' ? '#f8fafc' : '#0f172a',
              fontFamily: 'Tajawal, sans-serif'
            },
            className: 'backdrop-blur-md shadow-2xl'
          }} 
        />
      </div>
    </SocketProvider>
  );
};

function App() {
  return (
    <ThemeProvider>
      <Router>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          
          {/* Internal Protected Routes (Nested under Layout) */}
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager', 'staff']}>
                <PinGuard>
                  <LiveDashboard />
                </PinGuard>
              </ProtectedRoute>
            } />
            <Route path="/orders" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager', 'staff']} permission="manageOrders">
                <LiveOrders />
              </ProtectedRoute>
            } />
            <Route path="/menu" element={
              <ProtectedRoute requiredRole={['admin']} permission="menu">
                <MenuManager />
              </ProtectedRoute>
            } />
            <Route path="/branch-menu" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager']} permission="menu">
                <BranchMenu />
              </ProtectedRoute>
            } />
            <Route path="/reviews" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager']} permission="reviews">
                <ReviewsManager />
              </ProtectedRoute>
            } />
            <Route path="/customers" element={
              <ProtectedRoute requiredRole={['admin']}>
                <CustomerManager />
              </ProtectedRoute>
            } />
            <Route path="/loyalty" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager']} permission="loyalty">
                <LoyaltyManager />
              </ProtectedRoute>
            } />
            <Route path="/rewards-store" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager']} permission="rewardsStore">
                <RewardStoreManager />
              </ProtectedRoute>
            } />
            <Route path="/delivery-zones" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager']} permission="deliveryZones">
                <DeliveryZonesManager />
              </ProtectedRoute>
            } />
            
            {/* RBAC Protected Sub-routes */}
            <Route path="/broadcast" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager']} permission="notifications">
                <BroadcastNotifications />
              </ProtectedRoute>
            } />
            
            <Route path="/cancelled-orders" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager']} permission="manageOrders">
                <CancelledOrders />
              </ProtectedRoute>
            } />
            
            <Route path="/analytics" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager']} permission="advancedAnalytics">
                <Analytics />
              </ProtectedRoute>
            } />
            
            <Route path="/reports" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager']} permission="financials">
                <Reports />
              </ProtectedRoute>
            } />

            <Route path="/reports-dashboard" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager']} permission="financials">
                <ReportsDashboard />
              </ProtectedRoute>
            } />
            
            <Route path="/settings" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager']} permission="settings">
                <Settings />
              </ProtectedRoute>
            } />
            
            <Route path="/audit" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager']} permission="auditLog">
                <AuditLog />
              </ProtectedRoute>
            } />
            <Route path="/branches" element={
              <ProtectedRoute requiredRole="admin">
                <BranchManager />
              </ProtectedRoute>
            } />
            <Route path="/discounts" element={
              <ProtectedRoute requiredRole={['admin']}>
                <DiscountsManager />
              </ProtectedRoute>
            } />
            <Route path="/crm/leads" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager']}>
                <CRMLeads />
              </ProtectedRoute>
            } />
            <Route path="/crm/pipeline" element={
              <ProtectedRoute requiredRole={['admin', 'manager', 'branch_manager']}>
                <CRMPipeline />
              </ProtectedRoute>
            } />
            <Route path="/crm/custom-fields" element={
              <ProtectedRoute requiredRole={['admin']}>
                <CustomFieldsManager />
              </ProtectedRoute>
            } />
          </Route>
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

export default App;
