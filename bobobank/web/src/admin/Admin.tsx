import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, FileClock, Gauge, Headset, Landmark, Menu, Settings, ShieldAlert, Users, X, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { cx } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AuditPage, TransactionsPage } from './Journal';
import { Applications } from './Applications';
import { ClientDetail, Clients } from './Clients';
import { Dashboard } from './Dashboard';
import { Restrictions } from './Restrictions';
import { MarketPage } from './MarketPage';
import { SettingsPage } from './SettingsPage';
import { SupportDesk } from './Support';

export default function Admin() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: counts } = useQuery({ queryKey: ['admin', 'counts'], queryFn: () => api<{ counts: Record<string, number> }>('/support/threads?status=open').then((r) => r.counts), refetchInterval: 10_000, enabled: !!user && user.role !== 'client' });
  if (!user) return null;
  if (user.role === 'client') return <Navigate to="/app" replace />;
  const admin = user.role === 'admin';
  const items = [
    ...(admin
      ? [
          { to: '/admin', label: 'Сводка', icon: Gauge, end: true },
          { to: '/admin/clients', label: 'Клиенты', icon: Users },
          { to: '/admin/applications', label: 'Заявки на кредит', icon: Landmark },
          { to: '/admin/restrictions', label: 'Аресты и блокировки', icon: ShieldAlert },
        ]
      : []),
    { to: '/admin/support', label: 'Поддержка', icon: Headset, badge: counts?.open },
    ...(admin
      ? [
          { to: '/admin/transactions', label: 'Проводки', icon: ClipboardList },
          { to: '/admin/settings', label: 'Ставки и курсы', icon: Settings },
          { to: '/admin/market', label: 'Биржа', icon: TrendingUp },
          { to: '/admin/audit', label: 'Журнал действий', icon: FileClock },
        ]
      : []),
  ];
  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-4">
      <div className="mb-5 flex items-center justify-between px-2">
        <Logo compact />
        <span className="rounded-lg bg-ink px-2 py-0.5 text-xs font-semibold text-on-ink">{admin ? 'Админка' : 'Поддержка'}</span>
      </div>
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} onClick={() => setOpen(false)} className={({ isActive }) => cx('flex h-11 items-center gap-3 rounded-2xl px-3 text-[15px] font-semibold', isActive ? 'bg-brand-soft text-brand-strong dark:text-brand' : 'text-muted hover:bg-sunken hover:text-fg')}>
          <i.icon className="size-5" />
          {i.label}
          {!!i.badge && <span className="ml-auto min-w-5 rounded-full bg-bad px-1.5 text-center text-xs font-semibold text-white">{i.badge}</span>}
        </NavLink>
      ))}
      <button type="button" onClick={() => nav('/app')} className="mt-auto flex h-11 items-center gap-3 rounded-2xl px-3 text-[15px] font-semibold text-muted hover:bg-sunken"><ArrowLeft className="size-5" />В приложение</button>
    </nav>
  );
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-[280px] max-w-[85vw] bg-surface pt-[env(safe-area-inset-top)] bb-sheet" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-bg/90 px-4 backdrop-blur-xl lg:hidden">
          <button type="button" aria-label="Меню" onClick={() => setOpen(!open)} className="inline-flex size-10 items-center justify-center rounded-full hover:bg-sunken">{open ? <X className="size-5" /> : <Menu className="size-5" />}</button>
          <span className="font-semibold">{admin ? 'Админка Bobobank' : 'Поддержка Bobobank'}</span>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          <Routes>
            {admin && <Route index element={<Dashboard />} />}
            {!admin && <Route index element={<Navigate to="/admin/support" replace />} />}
            {admin && <Route path="clients" element={<Clients />} />}
            {admin && <Route path="clients/:id" element={<ClientDetail />} />}
            {admin && <Route path="applications" element={<Applications />} />}
            {admin && <Route path="restrictions" element={<Restrictions />} />}
            <Route path="support" element={<SupportDesk />} />
            <Route path="support/:id" element={<SupportDesk />} />
            {admin && <Route path="transactions" element={<TransactionsPage />} />}
            {admin && <Route path="settings" element={<SettingsPage />} />}
            {admin && <Route path="market" element={<MarketPage />} />}
            {admin && <Route path="audit" element={<AuditPage />} />}
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
