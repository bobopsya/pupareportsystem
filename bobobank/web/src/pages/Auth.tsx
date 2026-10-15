import { useQuery } from '@tanstack/react-query';
import { Lock, MessageSquareText } from 'lucide-react';
import { GosButton, GosMark, GosNote, useGosConfig } from '../components/Gos';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { Button, ErrorNote, Field, Input } from '../components/ui';
import { api, errorText } from '../lib/api';
import { useAuth, type User } from '../lib/auth';
import { formatPhoneInput, phoneDigits } from '../lib/format';

function Frame({ title, sub, children, foot }: { title: string; sub: string; children: ReactNode; foot: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pb-10 pt-[max(2rem,env(safe-area-inset-top))]">
      <Link to="/" className="mb-10"><Logo /></Link>
      <div className="w-full max-w-sm bb-fade">
        <h1 className="text-[28px] font-semibold leading-tight">{title}</h1>
        <p className="mt-1 text-muted">{sub}</p>
        <div className="mt-6">{children}</div>
        <div className="mt-6 text-center text-sm text-muted">{foot}</div>
      </div>
    </div>
  );
}

const nextPath = (p: URLSearchParams) => {
  const n = p.get('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/app';
};

export function Login() {
  const { setUser, user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gos = useGosConfig();
  useEffect(() => {
    if (user) nav(nextPath(params), { replace: true });
  }, [user, nav, params]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>('/auth/login', { body: { phone, password } });
      setUser(r.user);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame title="Вход в Bobobank" sub="По номеру телефона и паролю" foot={<>Ещё не клиент? <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`} className="font-semibold text-brand">Оформить карту</Link></>}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Телефон"><Input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))} placeholder="+7 900 000-00-00" /></Field>
        <Field label="Пароль"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {(error ?? params.get('gosError')) && <ErrorNote>{error ?? params.get('gosError')}</ErrorNote>}
        <Button type="submit" size="lg" variant="primary" loading={busy} disabled={phoneDigits(phone).length !== 11 || !password}>Войти</Button>
      </form>
      {gos && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-faint"><span className="h-px flex-1 bg-line" />или<span className="h-px flex-1 bg-line" /></div>
          <GosButton next={nextPath(params)} />
        </>
      )}
    </Frame>
  );
}

export function Register() {
  const { setUser, user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState<'phone' | 'code' | 'profile'>('phone');
  const [phone, setPhone] = useState('');
  const [sms, setSms] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const smsTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const gos = useGosConfig();
  const ticket = params.get('gos');
  const { data: pre, error: ticketError } = useQuery({
    queryKey: ['gos-ticket', ticket],
    queryFn: () => api<{ login: string; name: string; birthDate: string | null; passport: { number: string; country: string } | null; next: string }>(`/auth/gos/ticket?t=${encodeURIComponent(ticket!)}`),
    enabled: !!ticket,
    retry: false,
  });
  useEffect(() => {
    if (pre) {
      setName(pre.name);
      setBirth(pre.birthDate ?? '');
    }
  }, [pre]);
  useEffect(() => {
    if (user) nav(pre?.next ?? nextPath(params), { replace: true });
  }, [user, nav, params, pre]);
  useEffect(() => () => clearTimeout(smsTimer.current), []);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ code: string }>('/auth/code', { body: { phone } });
      setStep('code');
      setCode('');
      // The "SMS" arrives as a notification banner a moment later.
      smsTimer.current = setTimeout(() => setSms(r.code), 900);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const register = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>('/auth/register', { body: { phone, code, name, birthDate: birth, password, gosTicket: ticket ?? undefined } });
      setUser(r.user);
    } catch (e) {
      setError(errorText(e));
      if (/код/i.test(errorText(e))) setStep('code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {sms && (
        <button type="button" onClick={() => (setCode(sms), setSms(null))} className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 mx-auto flex max-w-sm items-start gap-3 rounded-[22px] bg-surface/95 p-3.5 text-left shadow-pop backdrop-blur-xl bb-sheet">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-on-brand"><MessageSquareText className="size-5" /></span>
          <span className="min-w-0 text-sm">
            <span className="flex justify-between gap-2"><b>Bobobank</b><span className="text-xs text-faint">сейчас</span></span>
            <span className="block">Код для входа в Bobobank: <b className="num">{sms}</b>. Никому его не сообщайте.</span>
          </span>
        </button>
      )}
      <Frame
        title={step === 'profile' ? 'Расскажите о себе' : 'Станьте клиентом'}
        sub={step === 'phone' ? 'Карта и счёт — за минуту, без визита в офис' : step === 'code' ? `Код отправлен на ${phone}` : 'Эти данные будут на карте и в договоре'}
        foot={<>Уже клиент? <Link to="/login" className="font-semibold text-brand">Войти</Link></>}
      >
        {gos && !ticket && (
          // Accounts are opened only with a Бобопаспорт: the bank takes the name and birth date from Бобуслуги.
          <div className="flex flex-col gap-4">
            <GosButton label="Продолжить через Бобуслуги" next={nextPath(params)} />
            <GosNote>Счёт открывается по Бобопаспорту. Имя и дату рождения мы получим с Бобуслуг — вводить их не нужно. Нет паспорта? Оформите его на <a href={gos.url} className="font-medium text-brand">Бобуслугах</a>.</GosNote>
          </div>
        )}
        {ticket && ticketError && <ErrorNote>{errorText(ticketError)}</ErrorNote>}
        {ticket && pre && (
          <div className="mb-5 flex items-center gap-3 rounded-2xl bg-surface p-4">
            <GosMark className="size-10" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-semibold">{pre.name}</div>
              <div className="text-muted">{pre.passport ? `Бобопаспорт ${pre.passport.number}` : 'Бобопаспорта нет — оформите его на Бобуслугах'}</div>
            </div>
          </div>
        )}
        {(!gos || (ticket && pre?.passport)) && step === 'phone' && (
          <form onSubmit={(e) => (e.preventDefault(), void requestCode())} className="flex flex-col gap-4">
            <Field label="Номер телефона"><Input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))} placeholder="+7 900 000-00-00" /></Field>
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button type="submit" size="lg" variant="primary" loading={busy} disabled={phoneDigits(phone).length !== 11}>Получить код</Button>
          </form>
        )}
        {step === 'code' && (
          <form onSubmit={(e) => (e.preventDefault(), code.length === 4 && setStep('profile'))} className="flex flex-col gap-4">
            <Field label="Код из СМС">
              <Input inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={4} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} className="text-center text-[26px] font-semibold tracking-[0.5em] num" placeholder="••••" />
            </Field>
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button type="submit" size="lg" variant="primary" disabled={code.length !== 4}>Продолжить</Button>
            <Button variant="ghost" onClick={() => void requestCode()}>Отправить код ещё раз</Button>
          </form>
        )}
        {step === 'profile' && (
          <form onSubmit={register} className="flex flex-col gap-4">
            {pre ? (
              <GosNote>
                <Lock className="mr-1 inline size-3.5 -translate-y-px" />
                {pre.name}, {pre.birthDate?.split('-').reverse().join('.')} — из Бобопаспорта
              </GosNote>
            ) : (
              <>
                <Field label="Имя и фамилия"><Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Иван Петров" /></Field>
                <Field label="Дата рождения"><Input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} max={new Date().toISOString().slice(0, 10)} /></Field>
              </>
            )}
            <Field label="Придумайте пароль" hint="Не короче 8 символов"><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button type="submit" size="lg" variant="primary" loading={busy} disabled={name.trim().length < 3 || !birth || password.length < 8}>Открыть счёт</Button>
            <p className="text-center text-xs text-muted">Нажимая кнопку, вы соглашаетесь с условиями обслуживания АО «Бобобанк»</p>
          </form>
        )}
      </Frame>
    </>
  );
}
