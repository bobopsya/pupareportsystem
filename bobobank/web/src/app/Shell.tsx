import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight, Bell, BarChart3, Check, Clock, Gift, Home, Landmark, LayoutGrid, LogOut, MessageCircle, PiggyBank, Shield, ShoppingBag, X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AccountPicker } from '../components/AccountPicker';
import { BankCard } from '../components/BankCard';
import { Logo, LogoMark } from '../components/Logo';
import { Button, cx, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money } from '../lib/format';
import { useRefresh } from '../lib/hooks';
import type { Account, Confirmation } from '../lib/types';

interface PayRequest {
  id: string;
  amount: number;
  currency: string;
  merchant: { name: string; site?: string };
  description: string;
  expiresAt: number;
}

interface Pulse {
  confirmations: Confirmation[];
  requests: PayRequest[];
  unread: number;
  chatUnread: number;
}

const NAV = [
  { to: '/app', label: 'Главная', icon: Home, end: true },
  { to: '/app/payments', label: 'Платежи', icon: ArrowLeftRight },
  { to: '/app/history', label: 'История', icon: Clock },
  { to: '/app/analytics', label: 'Расходы', icon: BarChart3 },
  { to: '/app/credits', label: 'Кредиты', icon: Landmark },
  { to: '/app/savings', label: 'Вклады', icon: PiggyBank },
  { to: '/app/bonus', label: 'Бобобонусы', icon: Gift },
  { to: '/app/chat', label: 'Чат с банком', icon: MessageCircle },
];

const TABS = [
  { to: '/app', label: 'Главная', icon: Home, end: true },
  { to: '/app/payments', label: 'Платежи', icon: ArrowLeftRight },
  { to: '/app/history', label: 'История', icon: Clock },
  { to: '/app/chat', label: 'Чат', icon: MessageCircle },
  { to: '/app/more', label: 'Ещё', icon: LayoutGrid },
];

function Dot({ n }: { n: number }) {
  if (!n) return null;
  return <span className="absolute -top-1 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-bad px-1 text-[11px] font-semibold leading-[18px] text-white text-center num">{n > 9 ? '9+' : n}</span>;
}

export default function Shell() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const refresh = useRefresh();
  const { data: pulse } = useQuery({ queryKey: ['pulse'], queryFn: () => api<Pulse>('/pulse'), refetchInterval: 3000, refetchIntervalInBackground: false });
  const last = useRef<string>('');
  useEffect(() => {
    const sig = `${pulse?.unread}:${pulse?.chatUnread}`;
    if (last.current && last.current !== sig) refresh();
    last.current = sig;
  }, [pulse?.unread, pulse?.chatUnread]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => window.scrollTo(0, 0), [loc.pathname]);
  const staff = user?.role === 'admin' || user?.role === 'support';
  const confirm = pulse?.confirmations[0];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_minmax(0,1fr)] lg:bg-[linear-gradient(to_right,var(--color-surface)_264px,transparent_264px)]">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex sticky top-0 h-dvh flex-col gap-1 border-r border-line bg-surface px-4 py-6">
        <NavLink to="/app" className="mb-6 px-2"><Logo /></NavLink>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('relative flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors', isActive ? 'bg-brand-soft text-brand-strong dark:text-brand' : 'text-fg/80 hover:bg-sunken hover:text-fg')}>
            <n.icon className="size-5" />
            {n.label}
            {n.to === '/app/chat' && !!pulse?.chatUnread && <span className="ml-auto min-w-5 rounded-full bg-bad px-1.5 text-center text-xs font-semibold text-white">{pulse.chatUnread}</span>}
          </NavLink>
        ))}
        {staff && (
          <NavLink to="/admin" className="mt-2 flex h-11 items-center gap-3 rounded-2xl px-3 text-[15px] font-semibold text-muted hover:bg-sunken hover:text-fg">
            <Shield className="size-5" /> {user?.role === 'admin' ? 'Админка' : 'Поддержка'}
          </NavLink>
        )}
        <div className="mt-auto flex items-center gap-2 rounded-2xl bg-sunken p-2">
          <button type="button" onClick={() => nav('/app/profile')} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1 text-left hover:bg-hover">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand font-semibold">{user?.name[0]}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{user?.name}</span>
              <span className="block text-xs text-muted">Профиль</span>
            </span>
          </button>
          <button type="button" aria-label="Выйти" title="Выйти" onClick={() => void logout().then(() => nav('/'))} className="inline-flex size-9 items-center justify-center rounded-xl text-muted hover:bg-hover hover:text-fg">
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-[calc(4rem+env(safe-area-inset-top))] items-center justify-between gap-3 bg-bg px-4 pt-[env(safe-area-inset-top)] sm:px-6 lg:px-10">
          <button type="button" onClick={() => nav('/app/profile')} className="flex min-w-0 items-center gap-2.5 lg:hidden">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand text-lg font-semibold">{user?.name[0]}</span>
            <span className="truncate text-[15px] font-semibold">{user?.name.split(' ')[0]}</span>
          </button>
          <span className="hidden lg:block text-sm text-muted">{greeting()}, {user?.name.split(' ')[0]}</span>
          <div className="flex items-center gap-1">
            {staff && (
              <button type="button" onClick={() => nav('/admin')} aria-label="Админка" className="lg:hidden inline-flex size-10 items-center justify-center rounded-full hover:bg-sunken"><Shield className="size-5" /></button>
            )}
            <button type="button" onClick={() => nav('/app/notifications')} aria-label="Уведомления" className="relative inline-flex size-10 items-center justify-center rounded-full hover:bg-sunken">
              <Bell className="size-[22px]" />
              {!!pulse?.unread && <span className="absolute top-2 right-2 size-2.5 rounded-full bg-bad ring-2 ring-bg" />}
            </button>
            <LogoMark className="size-8 lg:hidden" />
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-2 sm:px-6 lg:pb-16">
          <Outlet />
        </main>
      </div>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('flex h-[58px] flex-col items-center justify-center gap-1 text-[11px] font-medium', isActive ? 'text-brand' : 'text-muted')}>
              <span className="relative">
                <t.icon className="size-6" strokeWidth={1.8} />
                {t.to === '/app/chat' && <Dot n={pulse?.chatUnread ?? 0} />}
              </span>
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {confirm && <ConfirmPurchase key={confirm.id} c={confirm} />}
      {!confirm && pulse?.requests?.[0] && <ConfirmRequest key={pulse.requests[0].id} r={pulse.requests[0]} />}
    </div>
  );
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('ru-RU', { hour: 'numeric', hour12: false, timeZone: 'Europe/Moscow' }).format(Date.now()));
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
}

/** Purchase confirmation that pops over any screen while a GPAY checkout waits for it. */
function ConfirmPurchase({ c }: { c: Confirmation }) {
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const [left, setLeft] = useState(Math.max(0, Math.round((c.expiresAt - Date.now()) / 1000)));
  const toast = useToast();
  const qc = useQueryClient();
  const refresh = useRefresh();
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.round((c.expiresAt - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [c.expiresAt]);
  const answer = async (approve: boolean) => {
    setBusy(approve ? 'yes' : 'no');
    try {
      const r = await api<{ status: string; message?: string }>(`/confirmations/${c.id}`, { body: { approve } });
      if (r.status === 'declined' && approve) toast(r.message ?? 'Покупка отклонена', 'bad');
      else toast(approve ? 'Покупка подтверждена' : 'Покупка отклонена', approve ? 'ok' : 'bad');
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      await qc.invalidateQueries({ queryKey: ['pulse'] });
      refresh();
    }
  };
  const foreign = c.card && c.currency !== c.card.currency;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-label="Подтверждение покупки" className="bb-sheet w-full max-w-md rounded-t-[28px] bg-surface p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-2xl">
        <div className="flex items-center gap-3">
          <span className="relative flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <span className="absolute inset-0 rounded-2xl bg-brand/30 bb-ring" />
            <ShoppingBag className="size-6" />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] text-muted">Подтвердите покупку</div>
            <div className="truncate text-lg font-semibold">{c.merchant.name}</div>
          </div>
        </div>
        <div className="mt-5 text-[34px] font-semibold leading-none num">{money(c.amount, c.currency, { exact: c.amount % 100 !== 0 })}</div>
        {foreign && <div className="mt-1 text-sm text-muted">Спишем {money(c.accountAmount, c.card!.currency, { exact: true })} по курсу банка</div>}
        {c.card && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-sunken p-3">
            <BankCard card={c.card} size="sm" />
            <div className="min-w-0 text-sm">
              <div className="font-semibold">{c.card.networkTitle} •• {c.card.last4}</div>
              <div className="text-muted truncate">{c.merchant.site ?? 'Оплата через GPAY'}</div>
            </div>
          </div>
        )}
        <p className="mt-4 text-[13px] text-muted">Если вы не совершали эту покупку — отклоните её и заморозьте карту. Запрос действует ещё <span className="num font-semibold text-fg">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>.</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button size="lg" variant="secondary" loading={busy === 'no'} disabled={!!busy} icon={<X className="size-5" />} onClick={() => void answer(false)}>Отклонить</Button>
          <Button size="lg" variant="primary" loading={busy === 'yes'} disabled={!!busy} icon={<Check className="size-5" />} onClick={() => void answer(true)}>Подтвердить</Button>
        </div>
      </div>
    </div>
  );
}

/** Bobo Pay request sent from a GPAY checkout to this phone: pick an account and confirm. */
function ConfirmRequest({ r }: { r: PayRequest }) {
  const { data: home } = useQuery({ queryKey: ['home'], queryFn: () => api<{ accounts: Account[] }>('/home') });
  const accounts = (home?.accounts ?? []).filter((a) => a.currency === r.currency && ['current', 'savings', 'business', 'credit_card', 'kids'].includes(a.kind));
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const refresh = useRefresh();
  useEffect(() => {
    if (!from && accounts.length) setFrom(accounts[0].id);
  }, [accounts, from]);
  const answer = async (approve: boolean) => {
    setBusy(approve ? 'yes' : 'no');
    try {
      await api(`/requests/${r.id}`, { body: { approve, accountId: approve ? from : undefined } });
      toast(approve ? 'Оплачено через Bobo Pay' : 'Оплата отклонена', approve ? 'ok' : 'bad');
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(null);
      await qc.invalidateQueries({ queryKey: ['pulse'] });
      refresh();
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-label="Оплата Bobo Pay" className="bb-sheet w-full max-w-md rounded-t-[20px] bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-2xl">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line-strong sm:hidden" />
        <div className="text-[13px] text-muted">Оплата через Bobo Pay</div>
        <div className="text-lg font-semibold">{r.merchant.name}</div>
        <div className="mt-3 text-[32px] font-semibold leading-none num">{money(r.amount, r.currency, { exact: r.amount % 100 !== 0 })}</div>
        {r.description && <div className="mt-1 text-sm text-muted">{r.description}</div>}
        <div className="mt-4">
          <AccountPicker label="Списать со счёта" accounts={accounts} value={from} onChange={setFrom} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button size="lg" loading={busy === 'no'} disabled={!!busy} onClick={() => void answer(false)}>Отклонить</Button>
          <Button size="lg" variant="primary" loading={busy === 'yes'} disabled={!!busy || !from} onClick={() => void answer(true)}>Оплатить</Button>
        </div>
      </div>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between gap-3 px-1">
      <h2 className="text-[17px] font-semibold">{children}</h2>
      {action}
    </div>
  );
}

