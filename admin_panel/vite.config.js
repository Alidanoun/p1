import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Helper: proxy API only — serve index.html for browser navigation (SPA fallback)
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
      '/auth':           apiProxy('http://localhost:5000'),
      '/items':          apiProxy('http://localhost:5000'),
      '/orders':         apiProxy('http://localhost:5000'),
      '/categories':     apiProxy('http://localhost:5000'),
      '/notifications':  apiProxy('http://localhost:5000'),
      '/customers':      apiProxy('http://localhost:5000'),
      '/reviews':        apiProxy('http://localhost:5000'),
      '/settings':       apiProxy('http://localhost:5000'),
      '/metrics':        apiProxy('http://localhost:5000'),
      '/analytics':      apiProxy('http://localhost:5000'),
      '/system':         apiProxy('http://localhost:5000'),
      '/delivery-zones': apiProxy('http://localhost:5000'),
      '/dashboard':      apiProxy('http://localhost:5000'),
      '/restaurant':     apiProxy('http://localhost:5000'),
      '/health':         apiProxy('http://localhost:5000'),
    }
  }
})
