import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './index.css';

// 🏢 Production-Grade Query Client Configuration
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,      // 🛡️ Prevent jitter & refetch storms in real-time env
      gcTime: 1000 * 60 * 5, // 5 min cache persistence
      retry: 1,             // Lower retries (coordinated with axios-retry)
      refetchOnWindowFocus: false, // Managed manually via Sockets/Refresh hooks
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
