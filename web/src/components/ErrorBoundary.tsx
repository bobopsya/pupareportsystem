import { AlertTriangle, RotateCw } from 'lucide-react';
import { Component, type ReactNode } from 'react';

const RELOAD_KEY = 'zn.chunk-reload';

/** True for "the JS file of a page could not be loaded" — typically an old tab after the portal was updated. */
export function isChunkError(err: unknown) {
  const msg = String((err as Error)?.message ?? err);
  return /dynamically imported module|Importing a module script failed|module script|Failed to fetch|Loading chunk|preload/i.test(msg);
}

/** Reloads the page once to pick up the new build; returns false if we already tried recently. */
export function reloadForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Storage unavailable (private mode) — still try once.
  }
  window.location.reload();
  return true;
}

/** Shows an error card instead of a blank screen when a page crashes. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    if (isChunkError(error)) reloadForNewVersion();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkError(error);
    return (
      <div className="mx-auto mt-10 max-w-md rounded-lg border border-line bg-surface p-6 text-center">
        <AlertTriangle className="mx-auto size-8 text-warn" />
        <h2 className="mt-3 text-base font-semibold">{chunk ? 'Портал обновился' : 'Не удалось открыть раздел'}</h2>
        <p className="mt-1 text-sm text-muted">
          {chunk ? 'Перезагрузите страницу, чтобы загрузить новую версию.' : 'Произошла ошибка. Попробуйте перезагрузить страницу.'}
        </p>
        {!chunk && <pre className="mt-3 max-h-32 overflow-auto rounded bg-bg p-2 text-left text-[11px] text-faint whitespace-pre-wrap">{String((error as Error)?.message ?? error)}</pre>}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-fg bg-fg px-3.5 text-sm font-medium text-bg hover:bg-fg/85"
        >
          <RotateCw className="size-4" /> Перезагрузить
        </button>
      </div>
    );
  }
}
