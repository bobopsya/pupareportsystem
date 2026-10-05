import { Check, Copy, Loader2, Plus, X } from 'lucide-react';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import type { Tone } from '../lib/format';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ---------- Buttons ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-fg text-bg hover:bg-fg/85 border border-fg',
  secondary: 'bg-elevated text-fg border border-line hover:border-line-strong hover:bg-hover',
  ghost: 'text-muted hover:text-fg hover:bg-hover border border-transparent',
  danger: 'bg-transparent text-bad border border-bad/40 hover:bg-bad/10',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled || loading}
        className={cx(
          'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap select-none',
          size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
          VARIANT[variant],
          className,
        )}
        {...rest}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
        {children}
      </button>
    );
  },
);

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('inline-flex size-8 items-center justify-center rounded-md text-muted hover:text-fg hover:bg-hover transition-colors disabled:opacity-40', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------- Form controls ----------
const FieldIdCtx = createContext<string | undefined>(undefined);

/** Controls are full-width unless the caller sets a width class. */
const fullWidth = (className?: string) => (/(^|\s)([\w-]+:)?w-/.test(className ?? '') ? '' : 'w-full');

/** Stops nested controls from taking the enclosing Field's id (for composite pickers). */
export function NoFieldId({ children }: { children: ReactNode }) {
  return <FieldIdCtx.Provider value={undefined}>{children}</FieldIdCtx.Provider>;
}

const control = 'rounded-md border border-line bg-surface px-3 text-sm text-fg placeholder:text-faint focus:border-line-strong focus:outline-none focus-visible:outline-none focus:ring-1 focus:ring-fg/30 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(function Input({ className, mono, id, ...rest }, ref) {
  const fieldId = useContext(FieldIdCtx);
  return <input ref={ref} id={id ?? fieldId} className={cx(control, fullWidth(className), 'h-9', mono && 'font-mono', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(function Textarea({ className, mono, id, ...rest }, ref) {
  const fieldId = useContext(FieldIdCtx);
  return <textarea ref={ref} id={id ?? fieldId} className={cx(control, fullWidth(className), 'py-2 min-h-20', mono && 'font-mono', className)} {...rest} />;
});

export function Select({ className, children, id, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const fieldId = useContext(FieldIdCtx);
  return (
    <select id={id ?? fieldId} className={cx(control, fullWidth(className), 'h-9 pr-8 appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23a3a3a3%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22/%3E%3C/svg%3E")] bg-no-repeat bg-[right_0.6rem_center]', className)} {...rest}>
      {children}
    </select>
  );
}

/** Label + control. The label is tied to the control by id, so hints are not part of its accessible name. */
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5 min-w-0', className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <FieldIdCtx.Provider value={id}>{children}</FieldIdCtx.Provider>
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </div>
  );
}

/** `ariaLabel` names the checkbox for screen readers when `label` is not plain text. */
export function Checkbox({ checked, onChange, label, disabled, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; ariaLabel?: string }) {
  return (
    <span
      onClick={() => onChange(!checked)}
      className={cx('inline-flex items-center gap-2 text-sm cursor-pointer select-none', disabled && 'opacity-50 pointer-events-none')}
    >
      <span
        role="checkbox"
        aria-checked={checked}
        aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
        aria-disabled={disabled}
        tabIndex={0}
        onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), onChange(!checked))}
        className={cx('flex size-4 shrink-0 items-center justify-center rounded border transition-colors', checked ? 'bg-fg border-fg text-bg' : 'border-line-strong bg-surface')}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
      {label}
    </span>
  );
}

/** Free-form list of short strings (tags, phones, emails...). */
export function TagInput({ value, onChange, placeholder, mono }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; mono?: boolean }) {
  const [draft, setDraft] = useState('');
  const fieldId = useContext(FieldIdCtx);
  const add = () => {
    const parts = draft.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange(Array.from(new Set([...value, ...parts])));
    setDraft('');
  };
  return (
    <div className={cx(control, 'w-full flex flex-wrap items-center gap-1.5 py-1.5 min-h-9 h-auto')}>
      {value.map((t) => (
        <span key={t} className={cx('inline-flex items-center gap-1 rounded bg-hover border border-line px-1.5 py-0.5 text-xs', mono && 'font-mono')}>
          {t}
          <button type="button" aria-label={`Убрать ${t}`} className="text-faint hover:text-fg" onClick={() => onChange(value.filter((x) => x !== t))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={fieldId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
        placeholder={value.length ? '' : placeholder}
        className={cx('flex-1 min-w-24 bg-transparent text-sm outline-none placeholder:text-faint', mono && 'font-mono')}
      />
    </div>
  );
}

// ---------- Display ----------
const TONE: Record<Tone, string> = {
  neutral: 'text-muted border-line bg-hover',
  ok: 'text-ok border-ok/25 bg-ok/10',
  warn: 'text-warn border-warn/25 bg-warn/10',
  bad: 'text-bad border-bad/25 bg-bad/10',
  info: 'text-info border-info/25 bg-info/10',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap', TONE[tone], className)}>{children}</span>;
}

export function Dot({ on, className }: { on: boolean; className?: string }) {
  return <span className={cx('inline-block size-2 shrink-0 rounded-full', on ? 'bg-ok shadow-[0_0_0_3px] shadow-ok/15' : 'bg-faint', className)} />;
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('rounded-lg border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 h-11">
          <h2 className="text-sm font-medium truncate">{title}</h2>
          <div className="flex items-center gap-1">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="text-faint [&>svg]:size-8">{icon}</div>}
      <div className="text-sm font-medium">{title}</div>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-muted', className)} />;
}

export function Loading() {
  return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-bad">{error instanceof Error ? error.message : String(error)}</p>;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-mono text-[13px]', className)}>{children}</span>;
}

export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,35%)_1fr] gap-3 py-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 break-words">{children || <span className="text-faint">—</span>}</span>
    </div>
  );
}

// ---------- Overlays ----------
function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean | 'xl' }) {
  useEscape(onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-[2px] sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={cx('flex max-h-[92dvh] w-full flex-col rounded-t-xl sm:rounded-xl border border-line bg-surface shadow-2xl', wide === 'xl' ? 'sm:max-w-5xl' : wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 h-13 shrink-0">
          <h2 className="text-base font-semibold truncate">{title}</h2>
          <IconButton label="Закрыть" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 shrink-0">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Right-hand side panel (full screen on mobile). */
export function SidePanel({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  useEscape(onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="flex h-full w-full max-w-3xl flex-col border-l border-line bg-bg shadow-2xl">
        <header className="flex items-center gap-2 border-b border-line px-4 sm:px-5 h-14 shrink-0">
          <div className="min-w-0 flex-1 truncate font-semibold">{title}</div>
          {actions}
          <IconButton label="Закрыть" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

interface ConfirmState {
  title: string;
  body?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  resolve: (v: boolean) => void;
}
const ConfirmCtx = createContext<(o: Omit<ConfirmState, 'resolve'>) => Promise<boolean>>(async () => false);

interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}
const ToastCtx = createContext<(text: string, tone?: Tone) => void>(() => undefined);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirm] = useState<ConfirmState | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const confirm = useCallback((o: Omit<ConfirmState, 'resolve'>) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), []);
  const toast = useCallback((text: string, tone: Tone = 'neutral') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  const close = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirm(null);
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      <ToastCtx.Provider value={toast}>
        {children}
        <Modal
          open={!!confirmState}
          onClose={() => close(false)}
          title={confirmState?.title}
          footer={
            <>
              <Button onClick={() => close(false)}>Отмена</Button>
              <Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
                {confirmState?.confirmText ?? 'Подтвердить'}
              </Button>
            </>
          }
        >
          <div className="text-sm text-muted">{confirmState?.body}</div>
        </Modal>
        {createPortal(
          <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
            {toasts.map((t) => (
              <div key={t.id} className={cx('pointer-events-auto rounded-md border bg-elevated px-4 py-2.5 text-sm shadow-lg max-w-sm', t.tone === 'bad' ? 'border-bad/40 text-bad' : t.tone === 'ok' ? 'border-ok/30' : 'border-line')}>
                {t.text}
              </div>
            ))}
          </div>,
          document.body,
        )}
      </ToastCtx.Provider>
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx);
export const useToast = () => useContext(ToastCtx);

// ---------- Misc ----------
export function CopyButton({ value, label = 'Копировать', onCopied, clearAfterMs }: { value: string | (() => Promise<string>); label?: string; onCopied?: () => void; clearAfterMs?: number }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  return (
    <IconButton
      label={label}
      onClick={async () => {
        try {
          const text = typeof value === 'string' ? value : await value();
          await navigator.clipboard.writeText(text);
          setDone(true);
          onCopied?.();
          setTimeout(() => setDone(false), 1500);
          if (clearAfterMs) {
            toast(`Скопировано. Буфер очистится через ${Math.round(clearAfterMs / 1000)} с`);
            setTimeout(async () => {
              // Only clear if the clipboard still holds our secret.
              const now = await navigator.clipboard.readText().catch(() => text);
              if (now === text) await navigator.clipboard.writeText('').catch(() => undefined);
            }, clearAfterMs);
          }
        } catch (e) {
          toast(e instanceof Error ? e.message : 'Не удалось скопировать', 'bad');
        }
      }}
    >
      {done ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
    </IconButton>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line px-4 sm:px-5">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx('relative h-11 shrink-0 px-2.5 text-sm transition-colors', value === t.id ? 'text-fg' : 'text-muted hover:text-fg')}
        >
          {t.label}
          {value === t.id && <span className="absolute inset-x-1 -bottom-px h-0.5 bg-fg" />}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode; title?: string }[] }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.title}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx('inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors', value === o.id ? 'bg-hover text-fg' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AddRowButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={onClick}>
      {children}
    </Button>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export const th = 'h-10 px-3 text-left text-xs font-medium text-muted whitespace-nowrap border-b border-line first:pl-4 last:pr-4';
export const td = 'px-3 py-2.5 border-b border-line/70 align-middle first:pl-4 last:pr-4';
export const trHover = 'hover:bg-hover/60 transition-colors';
