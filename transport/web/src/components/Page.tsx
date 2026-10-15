import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

/** Plain page (history, profile, admin) with a back button to the map. */
export function Page({ title, children, actions, back = '/' }: { title: ReactNode; children: ReactNode; actions?: ReactNode; back?: string }) {
  const nav = useNavigate();
  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-bg px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="mb-4 flex items-center gap-2">
        <button type="button" aria-label="Назад" onClick={() => (window.history.length > 1 ? nav(-1) : nav(back))} className="-ml-1 inline-flex size-10 items-center justify-center rounded-full hover:bg-sunken">
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[22px] font-bold">{title}</h1>
        {actions}
      </header>
      <div className="bt-fade">{children}</div>
    </div>
  );
}

export function Section({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      {title && <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h2>}
      {children}
    </section>
  );
}
