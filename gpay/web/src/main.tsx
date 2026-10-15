import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './components/ui';
import './index.css';
import { AuthProvider } from './lib/auth';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } } });

// A tab opened before a deploy asks for chunks that no longer exist: reload once (not more often than every 30 s).
window.addEventListener('vite:preloadError', (e) => {
  try {
    if (Date.now() - Number(sessionStorage.getItem('gp-chunk-reload') ?? 0) < 30_000) return;
    sessionStorage.setItem('gp-chunk-reload', String(Date.now()));
  } catch {
    /* no storage: reload anyway */
  }
  e.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
