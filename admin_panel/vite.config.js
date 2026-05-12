import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 🌐 Vite Dev Proxy Configuration
 * All API requests are proxied to the local backend.
 * The /api/v1 prefix is the primary versioned route.
 */
const API_TARGET = 'http://127.0.0.1:5000';

const apiProxy = (target) => ({
  target,
  changeOrigin: true,
  onProxyRes: (proxyRes, req, res) => {
    // Prevent proxy from hanging on certain errors
  },
  onError: (err, req, res) => {
    // Silently handle proxy errors to avoid console flood
    if (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED') {
      return;
    }
    console.error('Proxy Error:', err);
  },
  bypass: (req) => {
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
      // 🛡️ Canonical API: All requests go through versioned path
      '/api/v1':         apiProxy(API_TARGET),
      
      // 🖼️ Static file serving
      '/uploads':        apiProxy(API_TARGET),
      
      // 📡 WebSocket transport
      '/socket.io': { 
        target: API_TARGET, 
        ws: true, 
        changeOrigin: true,
        onError: (err) => {
          if (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED') return;
          console.error('Socket Proxy Error:', err);
        }
      },

      // 🔒 Health checks (external probes)
      '/health':         apiProxy(API_TARGET),

      // 📖 API Documentation
      '/api-docs':       apiProxy(API_TARGET),
    }
  }
})
