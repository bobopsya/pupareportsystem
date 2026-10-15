import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './components/ui';
import './index.css';
import { applyTheme, getTheme } from './lib/theme';
import { AuthProvider } from './lib/auth';
import { reloadForNewBuild } from './components/ErrorBoundary';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 3_000 } } });

applyTheme(getTheme());

// A tab opened before a deploy asks for chunks that no longer exist: reload once to get the new build.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadForNewBuild()) e.preventDefault();
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
