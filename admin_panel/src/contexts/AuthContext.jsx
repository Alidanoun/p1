import { createContext, useState, useEffect, useContext } from 'react';
import api, { BASE_URL } from '../api/client';
import axios from 'axios';
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
        // 🔄 Silent Refresh
        const refreshResponse = await axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true });
        const refreshData = refreshResponse.data.success ? refreshResponse.data.data : refreshResponse.data;
        const { accessToken } = refreshData;
        tokenStore.set(accessToken);

        // 👤 Fetch Identity using raw axios with the fresh token
        const meResponse = await axios.get(`${BASE_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          withCredentials: true
        });
        setUser(meResponse.data.data);
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
      const { data: response } = await api.post('/auth/login', { email, password });
      const authData = response.success ? response.data : response;
      const { accessToken, user } = authData;

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
