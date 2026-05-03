import { createContext, useState, useEffect, useContext, useRef } from 'react';
import api, { executeRefresh } from '../api/client';
import { tokenStore } from '../api/tokenStore';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);

  /**
   * 🛡️ Bootstrap: Restore session without localStorage
   */
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // 🧹 Cleanup legacy storage (Migration)
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');

    const bootstrap = async () => {
      try {
        // 🔄 Atomic Singleton Refresh via client.js
        await executeRefresh();

        // 👤 Fetch Identity
        const meResponse = await api.get('/auth/me');
        setUser(meResponse.data.data);
      } catch (err) {
        console.warn('Session bootstrap failed:', err.response?.data?.error || err.message);
        tokenStore.clear();
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
  }, []);

  const [selectedBranchId, setSelectedBranchId] = useState(() => {
    const saved = sessionStorage.getItem('selectedBranchId');
    return saved && saved !== 'null' ? saved : null;
  });

  // 🔄 Cross-Tab Synchronization: Sync branch change across all open tabs
  useEffect(() => {
    const channel = new BroadcastChannel('branch_sync');
    
    channel.onmessage = (event) => {
      if (event.data.type === 'BRANCH_CHANGED') {
        setSelectedBranchId(event.data.branchId);
      }
    };

    return () => channel.close();
  }, []);

  const changeBranch = (branchId) => {
    setSelectedBranchId(branchId);
    const channel = new BroadcastChannel('branch_sync');
    channel.postMessage({ type: 'BRANCH_CHANGED', branchId });
    channel.close();
  };

  useEffect(() => {
    if (selectedBranchId) {
      sessionStorage.setItem('selectedBranchId', selectedBranchId);
    } else {
      sessionStorage.removeItem('selectedBranchId');
    }
  }, [selectedBranchId]);

  const login = async (email, password) => {
    try {
      const { data: response } = await api.post('/auth/login', { email, password });
      const authData = response.success ? response.data : response;
      const { accessToken, user } = authData;

      // 🔒 Save to memory only
      tokenStore.set(accessToken);
      setUser(user);
      
      // Reset branch context on login
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
      // 🚪 Notify server to clear cookie and revoke token
      await api.post('/auth/logout');
    } catch (err) {
      console.warn('Logout notification failed', err);
    } finally {
      tokenStore.clear();
      setUser(null);
      setSelectedBranchId(null);
      window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, selectedBranchId, setSelectedBranchId }}>
      {children}
    </AuthContext.Provider>
  );
};
