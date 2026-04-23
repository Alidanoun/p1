import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      // 🛡️ Proxy API requests to avoid Cross-Origin Cookie issues in development
      '/auth': 'http://localhost:5000',
      '/items': 'http://localhost:5000',
      '/orders': 'http://localhost:5000',
      '/categories': 'http://localhost:5000',
      '/notifications': 'http://localhost:5000',
      '/customers': 'http://localhost:5000',
      '/reviews': 'http://localhost:5000',
      '/settings': 'http://localhost:5000',
      '/metrics': 'http://localhost:5000',
      '/analytics': 'http://localhost:5000',
      '/system': 'http://localhost:5000',
      '/delivery-zones': 'http://localhost:5000',
      '/dashboard': 'http://localhost:5000',
    }
  }
})
