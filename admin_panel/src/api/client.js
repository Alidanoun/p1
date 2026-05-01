import axios from 'axios';
import { tokenStore } from './tokenStore';

const getBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (import.meta.env.PROD) throw new Error('CRITICAL: VITE_API_URL is missing in production');
  
  /** 
   * 🌐 Smart Local Proxy:
   * By returning an empty string, requests become relative (e.g., /auth/login).
   * This forces them to go through the Vite Proxy in vite.config.js.
   * This makes the browser treat the requests as "Same-Origin", ensuring 
   * HttpOnly Cookies are sent reliably without Cross-Origin/SameSite issues.
   */
  return '';
};
export const BASE_URL = getBaseUrl();

let isRefreshing = false;
let refreshPromise = null; // 🥇 Singleton Promise to coordinate all refresh requests
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // ✅ Required to send HttpOnly Cookies automatically
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add a request interceptor to attach JWT token from MEMORY
api.interceptors.request.use((config) => {
  const token = tokenStore.get(); // 🔒 Secure: Read from memory, not localStorage
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

// Add a response interceptor with automatic silent refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Avoid infinite loops if the refresh itself fails
    if (originalRequest.url.includes('/auth/refresh')) {
      if (error.response && [401, 403].includes(error.response.status)) {
        tokenStore.clear();
      }
      // ⚠️ Do NOT call forceLogout() here to avoid infinite redirect loops during bootstrap
      return Promise.reject(error);
    }

    // If 401 and we haven't already retried this request
    if (error.response && error.response.status === 401 && !originalRequest._retry) {

      if (refreshPromise) {
        // 🛡️ Queue this request until the ongoing refresh completes
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers['Authorization'] = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      
      // 🥇 Atomic Refresh singleton
      refreshPromise = (async () => {
        try {
          const response = await axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true });
          const refreshData = response.data.success ? response.data.data : response.data;
          const { accessToken } = refreshData;

          tokenStore.set(accessToken);
          processQueue(null, accessToken);
          return accessToken;
        } catch (err) {
          processQueue(err, null);
          if (err.response?.status === 401 || err.response?.status === 403) {
            tokenStore.clear();
            forceLogout();
          }
          throw err;
        } finally {
          refreshPromise = null;
        }
      })();

      const accessToken = await refreshPromise;
      originalRequest.headers['Authorization'] = `Bearer ${accessToken}`;
      return api(originalRequest);
    }

    // For 403 or other auth errors, check if it's a token issue
    if (error.response && error.response.status === 403) {
      const errMessage = error.response.data?.error?.toLowerCase() || '';
      if (errMessage.includes('token') || errMessage.includes('access denied') || errMessage.includes('unauthorized')) {
        forceLogout();
      }
    }

    return Promise.reject(error);
  }
);

function forceLogout() {
  // 🧹 Ensure memory store is cleared
  tokenStore.clear();

  // 🚀 Redirect to login
  window.location.href = '/login';
};

export const getImageUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http')) return path;

  const cleanPath = path.replace(/\\/g, '/');
  const separator = cleanPath.startsWith('/') ? '' : '/';

  return `${BASE_URL}${separator}${cleanPath}`;
};

/**
 * 🔓 يفك تغليف response الـ wrapped تلقائياً
 * يدعم 3 أشكال:
 *  1. Array مباشر:                    [...]
 *  2. Wrapped جديد:                   { success, data: [...] }
 *  3. Wrapped مع pagination:          { success, data: [...], pagination }
 */
export const unwrap = (response) => {
  const body = response?.data;
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object' && 'data' in body) return body.data;
  return body;
};

/**
 * 🔓 يجلب pagination metadata لو موجودة
 */
/**
 * 🔐 Centralized Bootstrap Refresh
 * Used by AuthContext to restore session on page load.
 */
export const executeRefresh = async () => {
  if (refreshPromise) return refreshPromise;
  
  refreshPromise = (async () => {
    try {
      const response = await axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true });
      const refreshData = response.data.success ? response.data.data : response.data;
      const { accessToken } = refreshData;
      tokenStore.set(accessToken);
      return accessToken;
    } finally {
      refreshPromise = null;
    }
  })();
  
  return refreshPromise;
};

export default api;
