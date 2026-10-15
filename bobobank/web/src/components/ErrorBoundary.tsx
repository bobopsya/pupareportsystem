import { Component, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i;
const KEY = 'bb-chunk-reload';

/**
 * After a deploy, a tab opened earlier asks for page chunks of the old build that no longer exist.
 * Reload once to pick up the new build (not more often than every 30 s, so a real outage does not loop).
 */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* no storage: still try once */
  }
  window.location.reload();
  return true;
}

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (CHUNK_ERROR.test(error.message)) reloadForNewBuild();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (CHUNK_ERROR.test(error.message)) return null;
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-[22px] font-semibold">Не удалось открыть страницу</div>
        <p className="max-w-sm text-sm text-muted">Попробуйте обновить. Если не поможет — пришлите в поддержку текст ниже.</p>
        <code className="max-w-sm break-words rounded-xl bg-sunken px-3 py-2 text-xs text-muted">{error.message}</code>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.location.reload()} className="h-11 rounded-xl bg-brand px-5 font-semibold text-on-brand">Обновить</button>
          <a href="/app" className="flex h-11 items-center rounded-xl bg-surface px-5 font-semibold">На главную</a>
        </div>
      </div>
    );
  }
}

/** Error boundary that resets when the page changes, so one broken page does not stick. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary key={pathname}>{children}</Boundary>;
}
