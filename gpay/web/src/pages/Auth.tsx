import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { CardLogos, PayLogo } from '../components/PaymentLogos';
import { Button, ErrorNote, Field, Input } from '../components/ui';
import { api, errorText } from '../lib/api';
import { useAuth, type User } from '../lib/auth';

function Shell({ children, title, sub }: { children: React.ReactNode; title: string; sub: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="flex flex-col px-5 sm:px-12 py-8">
        <Link to="/"><Logo /></Link>
        <div className="flex-1 flex items-center">
          <div className="w-full max-w-sm mx-auto py-10">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1.5 text-sm text-muted">{sub}</p>
            <div className="mt-7">{children}</div>
          </div>
        </div>
      </div>
      <div className="hidden lg:flex relative overflow-hidden bg-[#0f0d24] text-white p-12 flex-col justify-end">
        <div className="absolute -right-24 -top-24 size-[480px] rounded-full bg-[#5b3df5]/50 blur-3xl" />
        <div className="absolute left-10 top-24 size-60 rounded-full bg-[#22d3ee]/20 blur-3xl" />
        <div className="relative max-w-md">
          <div className="text-3xl font-semibold tracking-tight leading-tight">Карты, СБП, оплата частями и криптовалюта — в одном договоре</div>
          <ul className="mt-6 flex flex-col gap-2.5 text-white/80 text-sm">
            {['Подключение за 5 минут без визита в банк', 'Онлайн-касса и чеки по 54-ФЗ включены', 'API, вебхуки и виджет для разработчиков'].map((t) => (
              <li key={t} className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#a08dff]" />{t}</li>
            ))}
          </ul>
          <div className="mt-8 flex gap-1.5"><CardLogos /><PayLogo name="sbp" /></div>
        </div>
      </div>
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
    <Shell title="Вход в личный кабинет" sub={<>Нет аккаунта? <Link to="/register" className="text-brand font-medium">Подключите магазин</Link></>}>
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
        <Button type="submit" variant="primary" size="lg" loading={busy} icon={<ArrowRight className="size-4" />}>Войти</Button>
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
    <Shell title="Подключение к GPAY" sub={<>Уже есть аккаунт? <Link to="/login" className="text-brand font-medium">Войти</Link></>}>
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
        <Button type="submit" variant="primary" size="lg" loading={busy} icon={<ArrowRight className="size-4" />}>Создать аккаунт</Button>
        <p className="text-xs text-faint">Регистрируясь, вы соглашаетесь с офертой и политикой обработки персональных данных GPAY.</p>
      </form>
    </Shell>
  );
}
