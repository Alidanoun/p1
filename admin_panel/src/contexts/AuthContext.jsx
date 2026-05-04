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

    const bootstrap = async () => {
      // 🟢 Level 1: Optimistic Boot (Fast)
      const cachedUser = localStorage.getItem('user_cache');
      if (cachedUser) {
        try {
          setUser(JSON.parse(cachedUser));
        } catch (e) {
          localStorage.removeItem('user_cache');
        }
      }

      try {
        // 🟢 Level 2: Server-side validation (Truth)
        await executeRefresh();

        // 🟢 Level 3: Final state sync
        const meResponse = await api.get('/auth/me');
        const finalUser = meResponse.data.data;
        setUser(finalUser);
        localStorage.setItem('user_cache', JSON.stringify(finalUser));
      } catch (err) {
        console.warn('Session rehydration failed:', err.response?.data?.error || err.message);
        tokenStore.clear();
        setUser(null);
        localStorage.removeItem('user_cache');
      } finally {
        setLoading(false);
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
      const authData = response.success ? response.data : response;
      const { accessToken, user } = authData;

      tokenStore.set(accessToken);
      setUser(user);
      localStorage.setItem('user_cache', JSON.stringify(user));
      
      changeBranch(null);
      sessionStorage.removeItem('selectedBranchId');

      return { success: true };
    } catch (error) {
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
    if (user.role === 'super_admin') return true;
    if (Array.isArray(requiredRole)) return requiredRole.includes(user.role);
    return user.role === requiredRole;
  };

  const isAuthorized = (permission) => {
    if (!user) return false;
    if (user.role === 'super_admin') return true;
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
