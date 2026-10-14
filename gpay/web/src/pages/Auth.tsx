import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { CardLogos, PayLogo } from '../components/PaymentLogos';
import { Button, ErrorNote, Field, Input } from '../components/ui';
import { api, errorText } from '../lib/api';
import { useAuth, type User } from '../lib/auth';

function Shell({ children, title, sub }: { children: React.ReactNode; title: string; sub: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-sunken flex flex-col items-center px-4 py-8">
      <Link to="/"><Logo /></Link>
      <div className="flex-1 w-full flex items-center justify-center py-10">
        <div className="w-full max-w-[440px] rounded-[32px] bg-surface px-6 sm:px-10 py-10">
          <h1 className="text-[28px] font-bold leading-tight">{title}</h1>
          <p className="mt-2 text-muted">{sub}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5"><CardLogos /><PayLogo name="sbp" /></div>
    </div>
  );
}

export function Login() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (user) return <Navigate to="/app" replace />;
  return (
    <Shell title="Вход в личный кабинет" sub={<>Нет аккаунта? <Link to="/register" className="text-fg font-medium underline underline-offset-4">Подключите магазин</Link></>}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = await api<{ user: User }>('/auth/login', { body: { email, password } });
            setUser(r.user);
            navigate('/app');
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Email"><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
        <Field label="Пароль"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" variant="primary" size="lg" className="mt-2" loading={busy}>Войти</Button>
      </form>
    </Shell>
  );
}

export function Register() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (user) return <Navigate to="/app" replace />;
  return (
    <Shell title="Подключение к GPAY" sub={<>Уже есть аккаунт? <Link to="/login" className="text-fg font-medium underline underline-offset-4">Войти</Link></>}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = await api<{ user: User }>('/auth/register', { body: { name, email, password } });
            setUser(r.user);
            navigate('/app/new');
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Как к вам обращаться"><Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Анна Смирнова" autoFocus /></Field>
        <Field label="Рабочий email"><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="anna@company.ru" /></Field>
        <Field label="Пароль" hint="Не короче 8 символов"><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" variant="primary" size="lg" className="mt-2" loading={busy}>Создать аккаунт</Button>
        <p className="text-xs text-faint">Регистрируясь, вы соглашаетесь с офертой и политикой обработки персональных данных GPAY.</p>
      </form>
    </Shell>
  );
}
