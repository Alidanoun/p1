import { createContext, useState, useEffect, useContext } from 'react';
import api from '../api/client';
import { tokenStore } from '../api/tokenStore';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  /**
   * 🛡️ Bootstrap: Restore session without localStorage
   * Logic: Try to refresh from HttpOnly cookie. If it works, we get a new access token.
   */
  useEffect(() => {
    const bootstrap = async () => {
      // 🧹 Cleanup legacy storage (Migration)
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');

      try {
        // 🔄 Silent Refresh: Try to acquire access token using the cookie
        const { data } = await api.post('/auth/refresh');
        tokenStore.set(data.accessToken);

        // 👤 Fetch Identity
        const me = await api.get('/auth/me');
        setUser(me.data.data);
      } catch (err) {
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
      const response = await api.post('/auth/login', { email, password });
      const { accessToken, user } = response.data;

      // 🔒 Save to memory only
      tokenStore.set(accessToken);
      setUser(user);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.error || 'Login failed' };
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
