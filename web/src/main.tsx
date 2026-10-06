import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { reloadForNewVersion } from './components/ErrorBoundary';
import { OverlayProvider } from './components/ui';
import './index.css';
import { ApiError } from './lib/api';
import { AuthProvider } from './lib/auth';

// An old tab after a portal update asks for page files that no longer exist: reload to get the new build.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadForNewVersion()) e.preventDefault();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <OverlayProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </OverlayProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
