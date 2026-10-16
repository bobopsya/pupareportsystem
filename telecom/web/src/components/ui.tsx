import { Check, Loader2, X } from 'lucide-react';
import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'brand' | 'ink' | 'soft' | 'ghost' | 'danger';
const VARIANT: Record<Variant, string> = {
  brand: 'bg-brand text-on-brand hover:bg-brand-hover',
  ink: 'bg-ink text-on-ink hover:bg-ink-hover',
  soft: 'bg-sunken text-fg hover:bg-hover',
  ghost: 'text-fg hover:bg-sunken',
  danger: 'bg-bad-soft text-bad hover:brightness-95',
};
const SIZE = { sm: 'h-9 px-3.5 text-sm rounded-xl', md: 'h-12 px-5 text-[15px] rounded-2xl', lg: 'h-14 px-6 text-[17px] rounded-2xl' };

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE; loading?: boolean; icon?: ReactNode };

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'soft', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center gap-2 font-semibold transition-colors select-none whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none active:scale-[0.99]', SIZE[size], VARIANT[variant], className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-5 animate-spin" /> : icon}
      {children}
    </button>
  );
});

/** Round white button floating over the map. */
export function FloatButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx('pointer-events-auto inline-flex size-12 items-center justify-center rounded-full bg-surface text-fg shadow-[var(--shadow-float)] hover:bg-sunken', className)} {...rest}>
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-muted', className ?? 'size-5')} />;
}

export function Loading() {
  return (
    <div className="flex min-h-40 items-center justify-center">
      <Spinner className="size-6" />
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-bad-soft px-4 py-3 text-[15px] text-bad">{children}</div>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
      <span className="text-[15px]">{label}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-ink' : 'bg-line-strong')}>
        <span className={cx('absolute top-0.5 size-6 rounded-full bg-surface shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </button>
    </label>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" className="bt-sheet flex max-h-[92dvh] w-full flex-col rounded-t-[24px] bg-surface sm:max-w-md sm:rounded-3xl">
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-3">
          <h2 className="text-xl font-bold">{title}</h2>
          <button type="button" aria-label="Закрыть" onClick={onClose} className="inline-flex size-9 items-center justify-center rounded-full bg-sunken text-muted hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
        <div className={cx('overflow-y-auto overscroll-contain px-5', footer ? 'pb-4' : 'pb-[max(1.5rem,env(safe-area-inset-bottom))]')}>{children}</div>
        {footer && <div className="flex flex-col gap-2 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-1">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

type ToastItem = { id: number; text: string; tone: 'ok' | 'bad' };
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'bad') => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, text, tone }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-4 top-[max(1rem,env(safe-area-inset-top))] z-[1200] flex flex-col items-center gap-2" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className="bt-fade flex max-w-md items-start gap-2 rounded-2xl bg-ink px-4 py-3 text-sm font-medium text-on-ink shadow-[var(--shadow-float)]">
              {t.tone === 'ok' ? <Check className="mt-px size-4 shrink-0 text-brand" /> : <X className="mt-px size-4 shrink-0 text-bad" />}
              {t.text}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}
