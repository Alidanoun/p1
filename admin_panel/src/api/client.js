import axios from 'axios';
import { tokenStore } from './tokenStore';

export const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

let isRefreshing = false;
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
      tokenStore.clear();
      forceLogout();
      return Promise.reject(error);
    }

    // If 401 and we haven't already retried this request
    if (error.response && error.response.status === 401 && !originalRequest._retry) {

      if (isRefreshing) {
        // Queue this request until refresh completes
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers['Authorization'] = `Bearer ${token}`;
          return api(originalRequest);
        }).catch(err => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // 🔄 Silent Refresh: No need to pass token in body, it's in the HttpOnly cookie
        const response = await axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true });
        const refreshData = response.data.success ? response.data.data : response.data;
        const { accessToken } = refreshData;

        tokenStore.set(accessToken); // Save new short-lived token to memory

        api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
        originalRequest.headers['Authorization'] = `Bearer ${accessToken}`;

        processQueue(null, accessToken);

        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        tokenStore.clear();
        forceLogout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
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

const forceLogout = () => {
  // 🧹 Mandatory Cleanup: Ensure nothing sensitive remains in localStorage
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');

  // 🚀 Improvement: Redirect to login instead of root to avoid redirect loops
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
export const getPagination = (response) => {
  const body = response?.data;
  return body?.pagination || null;
};

export default api;
