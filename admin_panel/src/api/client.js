import axios from 'axios';
import axiosRetry from 'axios-retry';
import { tokenStore } from './tokenStore';

export const isValidBranchId = (id) => {
  return id && typeof id === 'string' && !['null', 'undefined', ''].includes(id.trim());
};

const getBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (import.meta.env.PROD) throw new Error('CRITICAL: VITE_API_URL is missing in production');
  
  /** 
   * 🌐 Versioned Proxy Path:
   * By returning '/api/v1', requests become relative to the versioned root (e.g., /api/v1/auth/login).
   * This is then handled by the Vite Proxy in vite.config.js and forwarded to the backend.
   */
  return '/api/v1';
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

// ✅ Advanced Retry Logic: Recover from network glitches & 5xx errors
axiosRetry(api, {
  retries: 3,
  retryDelay: (retryCount) => {
    return retryCount * 1000; // 1s, 2s, 3s
  },
  retryCondition: (error) => {
    // Retry on network errors, timeouts, or 5xx server errors
    return axiosRetry.isNetworkOrIdempotentRequestError(error) 
      || (error.response && error.response.status >= 500)
      || error.code === 'ECONNABORTED'; // Timeout recovery
  },
  onRetry: (retryCount, error, requestConfig) => {
    console.warn(`[API] Retry attempt #${retryCount} for: ${requestConfig.url}`, { error: error.message });
  }
});

// 🛰️ Tracing Interceptor: Inject unique IDs for distributed observability
api.interceptors.request.use((config) => {
  const correlationId = `c_${Math.random().toString(36).substring(2, 15)}`;
  const requestId = `r_${Math.random().toString(36).substring(2, 15)}`;
  
  config.headers['X-Correlation-ID'] = correlationId;
  config.headers['X-Request-Id'] = requestId;
  
  return config;
});

// Add a request interceptor to attach JWT token and Branch Context
api.interceptors.request.use((config) => {
  // 1. Attach JWT Token
  const token = tokenStore.get();
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }

  // 2. Attach Branch Context (Multi-tenancy isolation) - Admin only!
  try {
    const userCache = JSON.parse(sessionStorage.getItem('user_cache') || localStorage.getItem('user_cache') || '{}');
    const isAdmin = userCache.role?.toUpperCase() === 'ADMIN';

    if (isAdmin) {
      // ✅ Check both localStorage and sessionStorage
      const selectedBranchId = localStorage.getItem('selectedBranchId') || sessionStorage.getItem('selectedBranchId');

      if (isValidBranchId(selectedBranchId)) {
        const hasUrlBranch = config.url && (config.url.indexOf('branchId=') !== -1 || config.url.indexOf('branchId%3D') !== -1);
        const hasParamBranch = config.params && ('branchId' in config.params);
        
        if (!hasUrlBranch && !hasParamBranch) {
          // ✅ Add as query param (for backward compatibility)
          config.params = {
            ...config.params,
            branchId: selectedBranchId
          };
        }
        // ✅ Add as custom header (for robustness and unified context passing)
        config.headers['X-Branch-Context'] = selectedBranchId;
      }
    }
  } catch (err) {
    console.warn('Failed to parse user cache or inject branch context:', err);
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
      
      // 🥇 Atomic Refresh singleton (Safe guard against double-invocation)
      if (!refreshPromise) {
        refreshPromise = (async () => {
          try {
            const response = await axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true, timeout: 10000 });
            const refreshData = response.data.success ? response.data.data : response.data;
            const { accessToken } = refreshData;

            tokenStore.set(accessToken);
            processQueue(null, accessToken);
            return accessToken;
          } catch (err) {
            processQueue(err, null);
            if (err.response?.status === 401 || err.response?.status === 403 || err.response?.status === 429) {
              tokenStore.clear();
              forceLogout();
            }
            throw err;
          } finally {
            refreshPromise = null;
          }
        })();
      }

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
  if (!body) return null;
  if (Array.isArray(body)) return body;
  if (typeof body === 'object' && 'data' in body) return body.data;
  return body;
};

/**
 * 🔓 يجلب pagination metadata لو موجودة
 */
export const getPagination = (response) => {
  return response?.data?.pagination || null;
};
/**
 * 🔐 Centralized Bootstrap Refresh
 * Used by AuthContext to restore session on page load.
 */
export const executeRefresh = async () => {
  if (refreshPromise) return refreshPromise;
  
  refreshPromise = (async () => {
    try {
      const response = await axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true, timeout: 10000 });
      const refreshData = response.data.success ? response.data.data : response.data;
      const { accessToken } = refreshData;
      tokenStore.set(accessToken);
      processQueue(null, accessToken);
      return accessToken;
    } catch (err) {
      processQueue(err, null);
      throw err;
    } finally {
      refreshPromise = null;
    }
  })();
  
  return refreshPromise;
};

export default api;
