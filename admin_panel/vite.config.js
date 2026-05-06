import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 🌐 Vite Dev Proxy Configuration
 * All API requests are proxied to the local backend.
 * The /api/v1 prefix is the primary versioned route.
 */
const API_TARGET = 'http://localhost:5000';

const apiProxy = (target) => ({
  target,
  changeOrigin: true,
  bypass: (req) => {
    // If the browser is requesting a page (Accept: text/html), don't proxy, serve index.html
    if (req.headers.accept?.includes('text/html')) {
      return '/index.html';
    }
  }
});

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      // Primary versioned API route
      '/api/v1':         apiProxy(API_TARGET),
      // Legacy routes (backward compatibility during migration)
      '/auth':           apiProxy(API_TARGET),
      '/admin':          apiProxy(API_TARGET),
      '/items':          apiProxy(API_TARGET),
      '/orders':         apiProxy(API_TARGET),
      '/categories':     apiProxy(API_TARGET),
      '/notifications':  apiProxy(API_TARGET),
      '/customers':      apiProxy(API_TARGET),
      '/reviews':        apiProxy(API_TARGET),
      '/settings':       apiProxy(API_TARGET),
      '/metrics':        apiProxy(API_TARGET),
      '/analytics':      apiProxy(API_TARGET),
      '/system':         apiProxy(API_TARGET),
      '/delivery-zones': apiProxy(API_TARGET),
      '/dashboard':      apiProxy(API_TARGET),
      '/restaurant':     apiProxy(API_TARGET),
      '/health':         apiProxy(API_TARGET),
      '/loyalty':        apiProxy(API_TARGET),
      '/branch':         apiProxy(API_TARGET),
      '/api':            apiProxy(API_TARGET),
      '/uploads':        apiProxy(API_TARGET),
      '/financial':      apiProxy(API_TARGET),
      '/happyhour':      apiProxy(API_TARGET),
      '/order-modifications': apiProxy(API_TARGET),
      // Socket.IO
      '/socket.io':      { target: API_TARGET, ws: true, changeOrigin: true },
    }
  }
})
