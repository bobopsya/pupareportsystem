import { Check, Copy, Loader2, X } from 'lucide-react';
import {
  createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ---------- Buttons ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-hover',
  secondary: 'bg-sunken text-fg hover:bg-hover',
  ghost: 'text-muted hover:text-fg hover:bg-sunken',
  danger: 'bg-bad-soft text-bad hover:brightness-95',
  dark: 'bg-ink text-on-ink hover:bg-ink-hover',
};
const SIZE = { sm: 'h-9 px-3.5 text-sm rounded-[10px]', md: 'h-12 px-5 text-[15px] rounded-xl', lg: 'h-[52px] px-6 text-base rounded-xl' };

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE; loading?: boolean; icon?: ReactNode };

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center gap-2 font-semibold transition-colors select-none whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none', SIZE[size], VARIANT[variant], className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx('inline-flex size-9 items-center justify-center rounded-xl text-muted hover:text-fg hover:bg-sunken transition-colors disabled:opacity-40', className)} {...rest}>
      {children}
    </button>
  );
}

// ---------- Form controls ----------
const FieldId = createContext<string | undefined>(undefined);
const control = 'w-full rounded-xl border-[1.5px] border-transparent bg-sunken px-4 text-base text-fg placeholder:text-faint transition-colors hover:bg-hover focus:outline-none focus:bg-surface focus:border-brand disabled:opacity-60 aria-invalid:border-bad aria-invalid:bg-bad-soft';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean; invalid?: boolean }>(function Input({ className, mono, invalid, id, ...rest }, ref) {
  const fid = useContext(FieldId);
  return <input ref={ref} id={id ?? fid} aria-invalid={invalid || undefined} className={cx(control, 'h-13', mono && 'font-mono tracking-tight', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(function Textarea({ className, mono, id, ...rest }, ref) {
  const fid = useContext(FieldId);
  return <textarea ref={ref} id={id ?? fid} className={cx(control, 'py-3 min-h-24', mono && 'font-mono text-base sm:text-[13px]', className)} {...rest} />;
});

export function Select({ className, children, id, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const fid = useContext(FieldId);
  return (
    <select id={id ?? fid} className={cx(control, 'h-13 pr-10 appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2214%22%20height%3D%2214%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%238e91a6%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22/%3E%3C/svg%3E")] bg-no-repeat bg-[right_0.9rem_center]', className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children, className, aside }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; aside?: ReactNode }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5 min-w-0', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm text-muted">{label}</label>
        {aside}
      </div>
      <FieldId.Provider value={id}>{children}</FieldId.Provider>
      {error ? <span className="text-[13px] text-bad bb-fade">{error}</span> : hint ? <span className="text-[13px] text-faint">{hint}</span> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex items-center gap-2.5 text-sm cursor-pointer select-none', disabled && 'opacity-50 pointer-events-none')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-line-strong')}
      >
        <span className={cx('absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform', checked && 'translate-x-4')} />
      </button>
      {label}
    </label>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={cx('flex size-4 items-center justify-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-fg', checked ? 'bg-brand border-brand text-on-brand' : 'border-line-strong bg-surface')}>
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
      {label}
    </label>
  );
}

// ---------- Surfaces ----------
export function Card({ className, children, pad = true, id }: { className?: string; children: ReactNode; pad?: boolean; id?: string }) {
  return <div id={id} className={cx('scroll-mt-20 rounded-2xl bg-surface', pad && 'p-4 sm:p-5', className)}>{children}</div>;
}

export function CardHeader({ title, sub, actions, icon }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-5">
      <div className="flex items-start gap-3 min-w-0">
        {icon && <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sunken text-fg">{icon}</div>}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-snug">{title}</h2>
          {sub && <p className="text-sm text-muted mt-0.5">{sub}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-[28px] leading-tight font-semibold">{title}</h1>
        {sub && <p className="text-[15px] text-muted mt-1.5">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 max-w-full min-w-0">{actions}</div>}
    </div>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'brand';
const TONE: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info',
  neutral: 'bg-sunken text-muted',
  brand: 'bg-brand-soft text-brand',
};

export function Badge({ tone = 'neutral', children, icon, className }: { tone?: Tone; children: ReactNode; icon?: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[13px] font-medium whitespace-nowrap', TONE[tone], className)}>{icon}{children}</span>;
}

const DOT: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info', neutral: 'bg-faint', brand: 'bg-brand' };

/** Status as a coloured dot + plain text — quieter than a filled badge in dense tables. */
export function StatusDot({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm whitespace-nowrap">
      <span className={cx('size-2 rounded-full shrink-0', DOT[tone])} />
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-faint', className)} />;
}

export function Loading({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <Spinner /> {label}
    </div>
  );
}

export function Empty({ icon, title, sub, action }: { icon: ReactNode; title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-sunken text-fg mb-4">{icon}</div>
      <div className="text-lg font-semibold">{title}</div>
      {sub && <div className="text-sm text-muted mt-1 max-w-sm">{sub}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad bb-fade">{children}</div>;
}

// ---------- Copy ----------
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500);
  }, []);
  return { copy, copied };
}

export function CopyButton({ text, label = 'Копировать', className }: { text: string; label?: string; className?: string }) {
  const { copy, copied } = useCopy();
  return (
    <IconButton label={label} onClick={() => copy(text)} className={cx('size-7', className)}>
      {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
    </IconButton>
  );
}

export function CopyField({ value, mono = true, secret }: { value: string; mono?: boolean; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  return (
    <div className="flex items-center gap-1 rounded-xl bg-sunken pl-4 pr-1.5 h-12 min-w-0">
      <span className={cx('flex-1 truncate text-[13px]', mono && 'font-mono')} onClick={() => secret && setShown(true)}>
        {shown ? value : `${value.slice(0, 8)}${'•'.repeat(18)}`}
      </span>
      {secret && (
        <button type="button" className="text-xs text-brand font-semibold px-2" onClick={() => setShown((s) => !s)}>
          {shown ? 'Скрыть' : 'Показать'}
        </button>
      )}
      <CopyButton text={value} />
    </div>
  );
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button[data-autofocus]')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" className={cx('w-full max-h-[92dvh] flex flex-col rounded-t-[20px] sm:rounded-2xl bg-surface shadow-pop bb-sheet', size === 'sm' ? 'sm:max-w-sm' : size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 pt-3 sm:pt-6 pb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <IconButton label="Закрыть" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className={cx('px-5 sm:px-6 overflow-y-auto overscroll-contain', footer ? 'pb-5' : 'pb-[max(1.5rem,env(safe-area-inset-bottom))]')}>{children}</div>
        {footer && <div className="flex flex-col-reverse sm:flex-row sm:flex-wrap sm:justify-end gap-2 px-5 sm:px-6 pt-1 pb-[max(1.25rem,env(safe-area-inset-bottom))] [&>*]:w-full sm:[&>*]:w-auto">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Toasts ----------
type ToastItem = { id: number; text: string; tone: 'ok' | 'bad' };
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'bad') => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, text, tone }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] inset-x-4 z-[60] flex flex-col items-center gap-2 pointer-events-none" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className="bb-fade flex items-center gap-2 rounded-xl bg-ink text-on-ink px-4 py-3 text-sm font-medium shadow-pop">
              {t.tone === 'ok' ? <Check className="size-4 text-brand" /> : <X className="size-4 text-bad" />}
              {t.text}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

// ---------- Segmented control ----------
export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cx('inline-flex max-w-full overflow-x-auto [scrollbar-width:none] rounded-xl bg-sunken p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('h-9 px-3 sm:px-4 rounded-[10px] text-sm font-medium transition-colors whitespace-nowrap shrink-0', value === o.value ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.06)]' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <code className="rounded-md bg-sunken px-1.5 py-0.5 text-[13px] text-fg num">{children}</code>;
}
