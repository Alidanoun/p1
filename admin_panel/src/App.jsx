import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { Toaster } from 'sonner';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import LiveDashboard from './pages/LiveDashboard';
import LiveOrders from './pages/LiveOrders';
import MenuManager from './pages/MenuManager';
import Analytics from './pages/Analytics';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import BroadcastNotifications from './pages/BroadcastNotifications';
import ReviewsManager from './pages/ReviewsManager';
import CancelledOrders from './pages/CancelledOrders';
import LoyaltyManager from './pages/LoyaltyManager';
import RewardStoreManager from './pages/RewardStoreManager';
import DeliveryZonesManager from './pages/DeliveryZonesManager';
import AuditLog from './pages/AuditLog';
import BranchMenu from './pages/BranchMenu';

import ErrorBoundary from './components/ErrorBoundary';

const ProtectedLayout = ({ children }) => {
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
    // 🛡️ Preserve the intended destination URL
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return (
    <SocketProvider>
      <div className="flex bg-background w-full h-screen overflow-hidden text-text-main font-sans selection:bg-primary/20">
        <Sidebar />
      <main className="flex-1 overflow-y-auto overflow-x-hidden relative h-full">
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </main>
      
      {/* Premium Notification Toaster */}
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
  const { user } = useAuth();

  return (
    <ThemeProvider>
      <Router>
        <Routes>
          <Route 
            path="/login" 
            element={<Login />} 
          />
          
          <Route path="/" element={<ProtectedLayout><LiveDashboard /></ProtectedLayout>} />
          <Route path="/orders" element={<ProtectedLayout><LiveOrders /></ProtectedLayout>} />
          <Route path="/menu" element={<ProtectedLayout><MenuManager /></ProtectedLayout>} />
          <Route path="/branch-menu" element={<ProtectedLayout><BranchMenu /></ProtectedLayout>} />
          <Route path="/broadcast" element={<ProtectedLayout><BroadcastNotifications /></ProtectedLayout>} />
          <Route path="/reviews" element={<ProtectedLayout><ReviewsManager /></ProtectedLayout>} />
          <Route path="/cancelled-orders" element={<ProtectedLayout><CancelledOrders /></ProtectedLayout>} />
          <Route path="/loyalty" element={<ProtectedLayout><LoyaltyManager /></ProtectedLayout>} />
          <Route path="/rewards-store" element={<ProtectedLayout><RewardStoreManager /></ProtectedLayout>} />
          <Route path="/delivery-zones" element={<ProtectedLayout><DeliveryZonesManager /></ProtectedLayout>} />
          <Route path="/analytics" element={<ProtectedLayout><Analytics /></ProtectedLayout>} />
          <Route path="/reports" element={<ProtectedLayout><Reports /></ProtectedLayout>} />
          <Route path="/settings" element={<ProtectedLayout><Settings /></ProtectedLayout>} />
          <Route path="/audit" element={<ProtectedLayout><AuditLog /></ProtectedLayout>} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

export default App;
