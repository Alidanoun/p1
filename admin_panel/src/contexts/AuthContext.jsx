import { createContext, useState, useEffect, useContext, useRef } from 'react';
import api, { executeRefresh } from '../api/client';
import { tokenStore } from '../api/tokenStore';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);

  const [selectedBranchId, setBranchIdState] = useState(() => {
    const saved = sessionStorage.getItem('selectedBranchId');
    return saved && saved !== 'null' ? saved : null;
  });

  const setSelectedBranchId = (id) => {
    setBranchIdState(id);
    if (id && id !== 'all' && id !== null) {
      sessionStorage.setItem('selectedBranchId', id);
    } else {
      sessionStorage.removeItem('selectedBranchId');
    }
  };

  /**
   * 🛡️ 3-Level Rehydration Strategy:
   * 1. LocalStorage (Immediate/Optimistic)
   * 2. executeRefresh (Server-side validation)
   * 3. State Update (Final consistency)
   */
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // 🛡️ Safety Guard: Force loading to false after 5s to prevent infinite hang
    const safetyTimer = setTimeout(() => {
      if (loading) {
        console.warn('🧪 [AuthBootstrap] Safety timeout triggered. Forcing UI release.');
        setLoading(false);
      }
    }, 5000);

    const bootstrap = async () => {
      try {
        console.log('🧪 [AuthBootstrap] Phase 1: Checking cache...');
        const cachedUser = localStorage.getItem('user_cache');
        if (cachedUser) {
          try {
            setUser(JSON.parse(cachedUser));
            console.log('🧪 [AuthBootstrap] Optimistic user loaded');
          } catch (e) {
            localStorage.removeItem('user_cache');
          }
        }

        try {
          console.log('🧪 [AuthBootstrap] Phase 2: Server-side validation...');
          await executeRefresh();
          console.log('🧪 [AuthBootstrap] Refresh successful');

          console.log('🧪 [AuthBootstrap] Phase 3: Fetching profile...');
          const meResponse = await api.get('/auth/me');
          const finalUser = meResponse.data.data;
          setUser(finalUser);
          localStorage.setItem('user_cache', JSON.stringify(finalUser));
          console.log('🧪 [AuthBootstrap] Profile sync complete');
        } catch (err) {
          console.warn('🧪 [AuthBootstrap] FAILED:', err.response?.data?.error || err.message);
          tokenStore.clear();
          setUser(null);
          localStorage.removeItem('user_cache');
        } finally {
          console.log('🧪 [AuthBootstrap] Phase 4: Setting loading to false');
          setLoading(false);
          clearTimeout(safetyTimer);
        }
      } catch (criticalError) {
        setLoading(false);
        clearTimeout(safetyTimer);
      }
    };

    bootstrap();
  }, []);

  const changeBranch = (branchId) => {
    setSelectedBranchId(branchId);
  };

  const login = async (email, password) => {
    try {
      const { data: response } = await api.post('/auth/login', { email, password });
      console.log('🧪 [AuthDebug] Login Response Data:', response);
      const authData = response.success ? response.data : response;
      const { accessToken, user } = authData;

      if (!accessToken || !user) {
        console.error('❌ [AuthDebug] Missing token or user in response:', authData);
      }

      tokenStore.set(accessToken);
      setUser(user);
      localStorage.setItem('user_cache', JSON.stringify(user));
      
      changeBranch(null);
      sessionStorage.removeItem('selectedBranchId');

      console.log('✅ [AuthDebug] Login Success. User:', user.email);
      return { success: true };
    } catch (error) {
      console.error('🚨 [AuthDebug] Login Attempt Failed:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      const message = error.response?.data?.error?.message || error.response?.data?.error || 'Login failed';
      return { success: false, error: typeof message === 'string' ? message : JSON.stringify(message) };
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (err) {
      console.warn('Logout notification failed', err);
    } finally {
      tokenStore.clear();
      setUser(null);
      setSelectedBranchId(null);
      localStorage.removeItem('user_cache');
      window.location.href = '/login';
    }
  };

  const canAccess = (requiredRole) => {
    if (!user) return false;
    const role = user.role?.toLowerCase();
    // 👑 Administrative Power
    if (role === 'admin') return true;
    
    if (Array.isArray(requiredRole)) return requiredRole.includes(role);
    return role === requiredRole;
  };

  const isAuthorized = (permission) => {
    if (!user) return false;
    const role = user.role?.toLowerCase();
    if (role === 'admin') return true;
    return user.permissions?.[permission] === true;
  };

  return (
    <AuthContext.Provider value={{ 
      user, login, logout, loading, 
      selectedBranchId, setSelectedBranchId,
      canAccess, isAuthorized 
    }}>
      {children}
    </AuthContext.Provider>
  );
};
