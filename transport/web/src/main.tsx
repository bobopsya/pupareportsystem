import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './components/ui';
import './index.css';
import { applyTheme, getTheme } from './lib/theme';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 3_000 } } });

applyTheme(getTheme());

// A tab opened before a deploy asks for chunks that no longer exist: reload once to get the new build.
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('bt-chunk-reload') ?? 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem('bt-chunk-reload', String(Date.now()));
  } catch {
    /* no storage: still reload once */
  }
  e.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
