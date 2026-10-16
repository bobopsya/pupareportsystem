import { ArrowLeft, Home as HomeIcon, MessageCircle, Phone, ReceiptText, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useLine, useMe } from '../lib/hooks';
import { cx } from './ui';

const TABS = [
  { to: '/', label: 'Главная', icon: HomeIcon, end: true },
  { to: '/chats', label: 'Чаты', icon: MessageCircle },
  { to: '/calls', label: 'Звонки', icon: Phone },
  { to: '/history', label: 'Расходы', icon: ReceiptText },
  { to: '/profile', label: 'Профиль', icon: User },
];

function TabBar() {
  const me = useMe();
  const line = useLine(!!me.data?.user);
  if (!line.data?.line) return null;
  const unread = line.data.unread;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-[900] border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label="Разделы">
      <div className="mx-auto grid max-w-2xl grid-cols-5">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('relative flex h-[58px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium', isActive ? 'text-brand-text' : 'text-muted')}>
            <t.icon className="size-[22px]" />
            {t.label}
            {t.to === '/chats' && unread > 0 && <span className="absolute left-1/2 top-1.5 ml-2 min-w-[18px] rounded-full bg-bad px-1 text-center text-[11px] font-bold leading-[18px] text-white">{unread > 99 ? '99+' : unread}</span>}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/** A page of the app: a title (with a back button for nested pages) and the tab bar. */
export function Shell({ title, children, actions, back }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; back?: string }) {
  const nav = useNavigate();
  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-bg px-4 pb-[calc(76px+env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
      {title && (
        <header className="mb-4 flex min-h-10 items-center gap-2">
          {back && (
            <button type="button" aria-label="Назад" onClick={() => nav(back)} className="-ml-1 inline-flex size-10 items-center justify-center rounded-full hover:bg-sunken">
              <ArrowLeft className="size-5" />
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-[24px] font-bold tracking-tight">{title}</h1>
          {actions}
        </header>
      )}
      <div className="bt-fade">{children}</div>
      <TabBar />
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-3xl bg-surface p-4 ring-1 ring-line', className)}>{children}</div>;
}

export function Avatar({ name, system, className }: { name: string | null; system?: boolean; className?: string }) {
  const letter = (name ?? '#').trim()[0]?.toUpperCase() ?? '#';
  return (
    <span className={cx('flex shrink-0 items-center justify-center rounded-full font-bold', system ? 'bg-brand text-on-brand' : 'bg-brand-soft text-brand-text', className ?? 'size-11 text-[17px]')}>
      {system ? 'Б' : name ? letter : <Phone className="size-5" />}
    </span>
  );
}
