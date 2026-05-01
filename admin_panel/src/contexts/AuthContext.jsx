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
