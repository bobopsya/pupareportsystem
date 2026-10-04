import { useState, type FormEvent } from 'react';
import { LogoMark, Wordmark } from '../components/Logo';
import { Button, ErrorText, Field, Input } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { STRENGTH_LABEL, strength } from '../lib/password';

function Shell({ children, subtitle }: { children: React.ReactNode; subtitle: string }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <LogoMark size={64} />
          <div>
            <Wordmark className="text-2xl" />
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6">{children}</div>
        <p className="mt-6 text-center text-xs text-faint">Внутренняя система. Доступ только для сотрудников.</p>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login, notice } = useAuth();
  const [form, setForm] = useState({ login: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(form.login.trim(), form.password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell subtitle="Портал сотрудников">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {notice && <p className="rounded-md border border-line bg-elevated px-3 py-2 text-sm text-muted">{notice}</p>}
        <Field label="Логин">
          <Input autoFocus autoComplete="username" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required />
        </Field>
        <Field label="Пароль">
          <Input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" variant="primary" loading={busy} className="mt-1 w-full">
          Войти
        </Button>
      </form>
    </Shell>
  );
}

export function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const score = strength(form.next);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.next !== form.repeat) return setError(new Error('Пароли не совпадают'));
    if (form.next.length < 10) return setError(new Error('Минимум 10 символов'));
    if (score < 3) return setError(new Error('Пароль слишком простой — добавьте длины или разнообразия'));
    setBusy(true);
    try {
      await api('/auth/change-password', { body: { currentPassword: form.current, newPassword: form.next } });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Текущий (временный) пароль">
        <Input type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} required />
      </Field>
      <Field label="Новый пароль" hint={form.next ? `Надёжность: ${STRENGTH_LABEL[score]}` : 'Не короче 10 символов'}>
        <Input type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} required />
      </Field>
      {form.next && (
        <div className="-mt-2 flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`h-1 flex-1 rounded ${i < score ? (score >= 3 ? 'bg-ok' : 'bg-warn') : 'bg-line'}`} />
          ))}
        </div>
      )}
      <Field label="Повторите новый пароль">
        <Input type="password" autoComplete="new-password" value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })} required />
      </Field>
      <ErrorText error={error} />
      <Button type="submit" variant="primary" loading={busy}>
        Сменить пароль
      </Button>
    </form>
  );
}

export function ChangePasswordPage({ forced }: { forced?: boolean }) {
  const { refresh, logout } = useAuth();
  return (
    <Shell subtitle={forced ? 'Задайте свой пароль вместо временного' : 'Смена пароля'}>
      <ChangePasswordForm onDone={() => void refresh()} />
      <button type="button" onClick={() => void logout()} className="mt-4 w-full text-center text-xs text-faint hover:text-fg">
        Выйти
      </button>
    </Shell>
  );
}
