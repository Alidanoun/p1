import { createContext, useState, useEffect, useContext, useRef } from 'react';
import api, { BASE_URL } from '../api/client';
import { tokenStore } from '../api/tokenStore';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

/**
 * 🛡️ Module-level Singleton Promise
 * Persists across React StrictMode mount/unmount cycles.
 * Guarantees only ONE /auth/refresh request is ever made during app bootstrap.
 */
let _bootstrapPromise = null;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  /**
   * 🛡️ Bootstrap: Restore session without localStorage
   */
  useEffect(() => {
    if (!_bootstrapPromise) {
      // 🧹 Cleanup legacy storage (Migration)
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');

      _bootstrapPromise = (async () => {
        try {
          // 🔄 Silent Refresh using the configured api instance
          const response = await api.post('/auth/refresh');
          const refreshData = response.data.success ? response.data.data : response.data;
          const { accessToken } = refreshData;
          tokenStore.set(accessToken);

          // 👤 Fetch Identity
          const meResponse = await api.get('/auth/me');
          return meResponse.data.data;
        } catch (err) {
          console.warn('Session bootstrap failed:', err.response?.data?.error || err.message);
          tokenStore.clear();
          return null;
        }
      })();
    }

    // Both StrictMode calls attach to the SAME promise → only ONE HTTP request hits the wire
    _bootstrapPromise.then((resolvedUser) => {
      setUser(resolvedUser);
      setLoading(false);
    });
  }, []);

  const login = async (email, password) => {
    try {
      const { data: response } = await api.post('/auth/login', { email, password });
      const authData = response.success ? response.data : response;
      const { accessToken, user } = authData;

      // 🔒 Save to memory only
      tokenStore.set(accessToken);
      setUser(user);

      return { success: true };
    } catch (error) {
      const message = error.response?.data?.error?.message || error.response?.data?.error || 'Login failed';
      return { success: false, error: typeof message === 'string' ? message : JSON.stringify(message) };
    }
  };

  const logout = async () => {
    _bootstrapPromise = null; // 🔄 Allow fresh bootstrap if user logs in again without page refresh
    try {
      // 🚪 Notify server to clear cookie and revoke token
      await api.post('/auth/logout');
    } catch (err) {
      console.warn('Logout notification failed', err);
    } finally {
      tokenStore.clear();
      setUser(null);
      window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
